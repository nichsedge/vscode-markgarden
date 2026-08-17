const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseWikilinkTarget, extractHeadings } = require('./indexer');

/**
 * Simple LRU cache for parsed wikilink results keyed on (uri, version).
 * Avoids re-scanning the same unchanged document on every provider call.
 */
class DocumentParseCache {
  constructor(maxSize = 32) {
    this._cache = new Map();
    this._maxSize = maxSize;
  }

  _key(document) {
    return document.uri.toString() + ':' + document.version;
  }

  get(document) {
    const key = this._key(document);
    const entry = this._cache.get(key);
    if (entry) {
      // Move to end (most recently used)
      this._cache.delete(key);
      this._cache.set(key, entry);
      return entry;
    }
    return null;
  }

  set(document, value) {
    const key = this._key(document);
    // Evict oldest if at capacity
    if (this._cache.size >= this._maxSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, value);
  }
}

const wikilinkCache = new DocumentParseCache();

/**
 * Finds all wikilink matches in a text document.
 * Returns array of { range, target, raw, offset }
 * Uses an LRU cache to avoid re-parsing unchanged documents.
 */
function findWikilinksInDocument(document) {
  const cached = wikilinkCache.get(document);
  if (cached) return cached;

  const text = document.getText();
  const wikilinks = [];
  const regex = /\[\[([^[\r\n\]]+)\]\]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + match[0].length);
    wikilinks.push({
      range: new vscode.Range(startPos, endPos),
      target: match[1],
      raw: match[0],
      offset: match.index
    });
  }

  wikilinkCache.set(document, wikilinks);
  return wikilinks;
}

/**
 * Get wikilink under cursor in active editor if present.
 */
function getWikilinkAtPosition(document, position) {
  const links = findWikilinksInDocument(document);
  return links.find(link => link.range.contains(position)) || null;
}

/**
 * Resolves destination folder for newly created notes.
 */
function resolveNewNoteFolder(sourceFilePath) {
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const strategy = config.get('newNoteFolderStrategy', 'root');
  const customFolder = config.get('notesFolder', '');
  
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sourceFilePath)) ||
                          (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
  const rootPath = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(sourceFilePath);

  if (strategy === 'sameAsCurrent' && sourceFilePath) {
    return path.dirname(sourceFilePath);
  } else if (strategy === 'custom' && customFolder) {
    return path.resolve(rootPath, customFolder);
  }

  // Default: root
  return rootPath;
}

/**
 * DocumentLinkProvider to make [[wikilinks]] clickable in markdown files.
 * Uses cached parsed wikilinks and pre-resolved link targets from the indexer.
 */
class ObsidianDocumentLinkProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideDocumentLinks(document) {
    const links = findWikilinksInDocument(document);
    const meta = this.indexer.fileIndex.get(document.fileName);
    // Build a quick lookup map from targetNote -> resolved path using cached resolved links
    const resolvedMap = new Map();
    if (meta && meta.resolvedLinks) {
      for (const { link, targetPath } of meta.resolvedLinks) {
        resolvedMap.set(link.targetNote, targetPath);
      }
    }

    return links.map(item => {
      const parsed = parseWikilinkTarget(item.target);
      const targetPath = parsed.targetNote
        ? (resolvedMap.get(parsed.targetNote) || this.indexer.resolveNotePath(parsed.targetNote, document.fileName))
        : document.fileName;

      // Encode arguments for command URI
      const commandArgs = encodeURIComponent(JSON.stringify({
        target: item.target,
        sourceFile: document.fileName
      }));

      const linkUri = vscode.Uri.parse(`command:obsidian-notes.openWikilink?${commandArgs}`);
      const docLink = new vscode.DocumentLink(item.range, linkUri);
      docLink.tooltip = targetPath
        ? `Open "${parsed.targetNote || path.basename(document.fileName, '.md')}"${parsed.heading ? ' #' + parsed.heading : ''} (Ctrl/Cmd+Click)`
        : `Create "${parsed.targetNote}" (Ctrl/Cmd+Click)`;
      return docLink;
    });
  }
}

/**
 * DefinitionProvider to enable F12 ("Go to Definition") on [[wikilinks]].
 */
class ObsidianDefinitionProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideDefinition(document, position) {
    const link = getWikilinkAtPosition(document, position);
    if (!link) return null;

    const parsed = parseWikilinkTarget(link.target);
    const targetPath = parsed.targetNote
      ? this.indexer.resolveNotePath(parsed.targetNote, document.fileName)
      : document.fileName;

    if (!targetPath) return null;

    // Use fs.accessSync instead of existsSync — throws on missing
    try {
      fs.accessSync(targetPath);
    } catch {
      return null;
    }

    let targetLine = 0;
    if (parsed.heading) {
      // Check indexed headings first before reading from disk
      const targetMeta = this.indexer.fileIndex.get(targetPath);
      if (targetMeta && targetMeta.headings) {
        const headingMatch = targetMeta.headings.find(h => h.text.toLowerCase() === parsed.heading.toLowerCase());
        if (headingMatch) {
          targetLine = headingMatch.line;
        }
      } else {
        try {
          const content = fs.readFileSync(targetPath, 'utf8');
          const headings = extractHeadings(content);
          const headingMatch = headings.find(h => h.text.toLowerCase() === parsed.heading.toLowerCase());
          if (headingMatch) {
            targetLine = headingMatch.line;
          }
        } catch {
          // Fallback to line 0
        }
      }
    }

    return new vscode.Location(
      vscode.Uri.file(targetPath),
      new vscode.Position(targetLine, 0)
    );
  }
}

/**
 * CompletionItemProvider for [[wikilinks]] note titles and #headings.
 */
class ObsidianCompletionItemProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideCompletionItems(document, position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character);
    const lastOpenBracket = linePrefix.lastIndexOf('[[');
    if (lastOpenBracket === -1) return undefined;

    // Check if bracket is already closed on the right before cursor
    const textAfterBracket = linePrefix.substring(lastOpenBracket + 2);
    if (textAfterBracket.includes(']]')) return undefined;

    const items = [];
    const hashIndex = textAfterBracket.indexOf('#');

    if (hashIndex !== -1) {
      // Autocomplete headings within the target note (or current note if [[#...)
      const targetNoteName = textAfterBracket.substring(0, hashIndex).trim();
      let targetFile = document.fileName;

      if (targetNoteName) {
        targetFile = this.indexer.resolveNotePath(targetNoteName, document.fileName);
      }

      if (targetFile) {
        // Use indexed headings if available
        const targetMeta = this.indexer.fileIndex.get(targetFile);
        const headings = targetMeta ? targetMeta.headings : null;

        if (headings) {
          for (const h of headings) {
            const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
            item.detail = `Heading (H${h.level}) in ${path.basename(targetFile)}`;
            item.insertText = h.text;
            items.push(item);
          }
        } else {
          try {
            fs.accessSync(targetFile);
            const content = fs.readFileSync(targetFile, 'utf8');
            const diskHeadings = extractHeadings(content);
            for (const h of diskHeadings) {
              const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
              item.detail = `Heading (H${h.level}) in ${path.basename(targetFile)}`;
              item.insertText = h.text;
              items.push(item);
            }
          } catch {
            // ignore
          }
        }
      }
      return items;
    }

    // Autocomplete note titles
    const allNotes = this.indexer.getAllNotes();
    const seenTitles = new Set();

    for (const note of allNotes) {
      // Suggest baseName
      if (!seenTitles.has(note.baseName)) {
        seenTitles.add(note.baseName);
        const item = new vscode.CompletionItem(note.baseName, vscode.CompletionItemKind.File);
        item.detail = note.relativePath;
        if (note.frontmatterTitle && note.frontmatterTitle !== note.baseName) {
          item.documentation = `Title: ${note.frontmatterTitle}`;
        }
        items.push(item);
      }

      // Suggest frontmatter title if different
      if (note.title && note.title !== note.baseName && !seenTitles.has(note.title)) {
        seenTitles.add(note.title);
        const item = new vscode.CompletionItem(note.title, vscode.CompletionItemKind.File);
        item.detail = `${note.baseName}.md (${note.relativePath})`;
        items.push(item);
      }
    }

    return items;
  }
}

/**
 * Handles navigation to or creation of a Wikilink target.
 */
async function navigateWikilink(targetStr, sourceFilePath, indexer) {
  if (!targetStr) return;

  const parsed = parseWikilinkTarget(targetStr);
  let targetPath = parsed.targetNote
    ? indexer.resolveNotePath(parsed.targetNote, sourceFilePath)
    : sourceFilePath;

  // If note doesn't exist, create it
  if (!targetPath || !fs.existsSync(targetPath)) {
    if (!parsed.targetNote) {
      vscode.window.showErrorMessage('Obsidian Notes: Invalid link target.');
      return;
    }

    const folder = resolveNewNoteFolder(sourceFilePath);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (err) {
      vscode.window.showErrorMessage(`Obsidian Notes: Failed to create directory: ${err.message}`);
      return;
    }

    const newFilename = `${parsed.targetNote}.md`;
    targetPath = path.join(folder, newFilename);

    const initialContent = `---\ntitle: "${parsed.targetNote}"\ndate: ${new Date().toISOString()}\n---\n\n# ${parsed.targetNote}\n`;
    try {
      fs.writeFileSync(targetPath, initialContent, 'utf8');
      indexer.handleFileChange(targetPath);
      vscode.window.showInformationMessage(`Obsidian Notes: Created note "${newFilename}".`);
    } catch (err) {
      vscode.window.showErrorMessage(`Obsidian Notes: Failed to create note: ${err.message}`);
      return;
    }
  }

  // Open the document
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(doc);

    // If heading anchor is present, jump to heading
    if (parsed.heading) {
      // Use indexed headings if available
      const targetMeta = indexer.fileIndex.get(targetPath);
      let headingMatch = null;
      if (targetMeta && targetMeta.headings) {
        headingMatch = targetMeta.headings.find(h => h.text.toLowerCase() === parsed.heading.toLowerCase());
      }
      if (!headingMatch) {
        const content = doc.getText();
        const headings = extractHeadings(content);
        headingMatch = headings.find(h => h.text.toLowerCase() === parsed.heading.toLowerCase());
      }

      if (headingMatch) {
        const line = headingMatch.line;
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showWarningMessage(`Obsidian Notes: Heading "#${parsed.heading}" not found in "${path.basename(targetPath)}".`);
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to open document: ${err.message}`);
  }
}

/**
 * Command: Open link under cursor
 */
async function openLinkAtCursor(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    return;
  }

  const link = getWikilinkAtPosition(editor.document, editor.selection.active);
  if (!link) {
    vscode.window.showInformationMessage('Obsidian Notes: Cursor is not on a [[wikilink]].');
    return;
  }

  await navigateWikilink(link.target, editor.document.fileName, indexer);
}

module.exports = {
  findWikilinksInDocument,
  getWikilinkAtPosition,
  resolveNewNoteFolder,
  navigateWikilink,
  openLinkAtCursor,
  ObsidianDocumentLinkProvider,
  ObsidianDefinitionProvider,
  ObsidianCompletionItemProvider
};
