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
 * Finds all wikilink and transclusion embed matches in a text document.
 * Returns array of { range, target, raw, offset, isEmbed }
 * Uses an LRU cache to avoid re-parsing unchanged documents.
 */
function findWikilinksInDocument(document) {
  const cached = wikilinkCache.get(document);
  if (cached) return cached;

  const text = document.getText();
  const wikilinks = [];
  const regex = /(!?\[\[)([^[\r\n\]]+)\]\]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const isEmbed = match[1] === '![[';
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + match[0].length);
    wikilinks.push({
      range: new vscode.Range(startPos, endPos),
      target: match[2],
      raw: match[0],
      offset: match.index,
      isEmbed
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
  const config = vscode.workspace.getConfiguration('markgarden');
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
 * Recursively searches a directory for a file matching filename (up to maxDepth).
 */
function findFileRecursive(dir, filename, maxDepth = 4, currentDepth = 0) {
  if (!dir || currentDepth > maxDepth) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return path.join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (name === 'node_modules' || name === '.git' || name === '.vscode' || name === 'dist' || name === 'out' || name === 'vendor') {
          continue;
        }
        const found = findFileRecursive(path.join(dir, name), filename, maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Resolves media file path (images, audio, video, PDF) in workspace.
 */
function resolveMediaFilePath(mediaTarget, sourceFilePath, indexer = null) {
  if (!mediaTarget) return null;
  let cleanTarget = mediaTarget.trim();
  const pipeIdx = cleanTarget.indexOf('|');
  if (pipeIdx !== -1) cleanTarget = cleanTarget.slice(0, pipeIdx).trim();
  const hashIdx = cleanTarget.indexOf('#');
  if (hashIdx !== -1) cleanTarget = cleanTarget.slice(0, hashIdx).trim();

  // 1. Check indexer first if available
  if (indexer && typeof indexer.resolveMediaPath === 'function') {
    const indexedPath = indexer.resolveMediaPath(cleanTarget, sourceFilePath);
    if (indexedPath) return indexedPath;
  }

  // 2. Direct check relative to source file directory
  if (sourceFilePath) {
    const sourceDir = path.dirname(sourceFilePath);
    const relativeCandidate = path.resolve(sourceDir, cleanTarget);
    try {
      if (fs.existsSync(relativeCandidate) && fs.statSync(relativeCandidate).isFile()) {
        return relativeCandidate;
      }
    } catch {
      // ignore
    }
  }

  // 3. Check in workspace root and common attachment subdirectories
  const workspaceFolder = (sourceFilePath && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sourceFilePath))) ||
                          (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
  if (workspaceFolder) {
    const rootPath = workspaceFolder.uri.fsPath;
    const cleanBase = path.basename(cleanTarget);
    const candidates = [
      path.resolve(rootPath, cleanTarget),
      path.resolve(rootPath, 'attachments', cleanTarget),
      path.resolve(rootPath, 'assets', cleanTarget),
      path.resolve(rootPath, 'images', cleanTarget),
      path.resolve(rootPath, 'media', cleanTarget),
      path.resolve(rootPath, 'static', cleanTarget),
      path.resolve(rootPath, 'content/assets', cleanTarget)
    ];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch {
        // ignore
      }
    }

    // 4. Recursive search fallback in workspace
    const recursiveMatch = findFileRecursive(rootPath, cleanBase);
    if (recursiveMatch) return recursiveMatch;
  }

  return null;
}

/**
 * DocumentLinkProvider to make [[wikilinks]] and ![[embeds]] clickable in markdown files.
 * Uses cached parsed wikilinks and pre-resolved link targets from the indexer.
 */
class MarkGardenDocumentLinkProvider {
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

      // Encode arguments for command URI
      const commandArgs = encodeURIComponent(JSON.stringify({
        target: item.target,
        sourceFile: document.fileName
      }));

      const linkUri = vscode.Uri.parse(`command:markgarden.openWikilink?${commandArgs}`);
      const docLink = new vscode.DocumentLink(item.range, linkUri);

      if (parsed.isMedia) {
        const mediaPath = resolveMediaFilePath(parsed.targetNote, document.fileName, this.indexer);
        docLink.tooltip = mediaPath
          ? `Open media file "${parsed.targetNote}" (Ctrl/Cmd+Click)`
          : `Media file "${parsed.targetNote}" (not found)`;
        return docLink;
      }

      const targetPath = parsed.targetNote
        ? (resolvedMap.get(parsed.targetNote) || this.indexer.resolveNotePath(parsed.targetNote, document.fileName))
        : document.fileName;

      let anchorText = '';
      if (parsed.blockId) anchorText = ` #^${parsed.blockId}`;
      else if (parsed.heading) anchorText = ` #${parsed.heading}`;

      docLink.tooltip = targetPath
        ? `Open "${parsed.targetNote || path.basename(document.fileName, '.md')}"${anchorText} (Ctrl/Cmd+Click)`
        : `Create "${parsed.targetNote}" (Ctrl/Cmd+Click)`;
      return docLink;
    });
  }
}

/**
 * DefinitionProvider to enable F12 ("Go to Definition") on [[wikilinks]].
 */
class MarkGardenDefinitionProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideDefinition(document, position) {
    const link = getWikilinkAtPosition(document, position);
    if (!link) return null;

    const parsed = parseWikilinkTarget(link.target);

    if (parsed.isMedia) {
      const mediaPath = this.indexer.resolveMediaPath
        ? this.indexer.resolveMediaPath(parsed.targetNote, document.fileName)
        : resolveMediaFilePath(parsed.targetNote, document.fileName);
      if (mediaPath) {
        try {
          fs.accessSync(mediaPath);
          return new vscode.Location(vscode.Uri.file(mediaPath), new vscode.Position(0, 0));
        } catch {
          return null;
        }
      }
      return null;
    }

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
    const targetMeta = this.indexer.fileIndex.get(targetPath);

    if (parsed.blockId) {
      const cleanBlockId = parsed.blockId.toLowerCase();
      if (targetMeta && targetMeta.blockMap && targetMeta.blockMap.has(cleanBlockId)) {
        targetLine = targetMeta.blockMap.get(cleanBlockId).line;
      } else {
        try {
          const content = fs.readFileSync(targetPath, 'utf8');
          const lines = content.split(/\r?\n/);
          const blockRegex = new RegExp(`(?:^|[ \\t]+)\\^${cleanBlockId}[ \\t]*$`, 'i');
          for (let i = 0; i < lines.length; i++) {
            if (blockRegex.test(lines[i])) {
              targetLine = i;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    } else if (parsed.heading) {
      // Check indexed headings first before reading from disk
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
 * CompletionItemProvider for [[wikilinks]] note titles, #headings, and #^blocks.
 */
class MarkGardenCompletionItemProvider {
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
      // Autocomplete headings or blocks within the target note (or current note if [[#...)
      const targetNoteName = textAfterBracket.substring(0, hashIndex).trim();
      const searchAnchor = textAfterBracket.substring(hashIndex + 1);
      let targetFile = document.fileName;

      if (targetNoteName) {
        targetFile = this.indexer.resolveNotePath(targetNoteName, document.fileName);
      }

      if (targetFile) {
        const targetMeta = this.indexer.fileIndex.get(targetFile);

        // If typing #^..., prioritize block references
        if (searchAnchor.startsWith('^')) {
          const blocks = targetMeta ? targetMeta.blocks : null;
          if (blocks) {
            for (const b of blocks) {
              const item = new vscode.CompletionItem(`^${b.id}`, vscode.CompletionItemKind.Reference);
              item.detail = `Block reference in ${path.basename(targetFile)}`;
              item.documentation = b.text;
              item.insertText = `^${b.id}`;
              items.push(item);
            }
          }
          return items;
        }

        // Headings autocompletion
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

        // Also suggest block references if available
        if (targetMeta && targetMeta.blocks && targetMeta.blocks.length > 0) {
          for (const b of targetMeta.blocks) {
            const item = new vscode.CompletionItem(`^${b.id}`, vscode.CompletionItemKind.Reference);
            item.detail = `Block reference in ${path.basename(targetFile)}`;
            item.documentation = b.text;
            item.insertText = `^${b.id}`;
            items.push(item);
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

    // Autocomplete media files
    if (this.indexer.getAllMediaFiles) {
      const mediaFiles = this.indexer.getAllMediaFiles();
      for (const media of mediaFiles) {
        if (!seenTitles.has(media.baseName)) {
          seenTitles.add(media.baseName);
          const item = new vscode.CompletionItem(media.baseName, vscode.CompletionItemKind.File);
          item.detail = `Media Attachment (${path.basename(media.filePath)})`;
          items.push(item);
        }
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

  // If target is a media attachment (e.g. image, video, pdf), open media file directly
  if (parsed.isMedia) {
    const mediaPath = resolveMediaFilePath(parsed.targetNote, sourceFilePath, indexer);
    if (mediaPath) {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(mediaPath));
    } else {
      vscode.window.showWarningMessage(`MarkGarden: Media file "${parsed.targetNote}" not found in workspace.`);
    }
    return;
  }

  let targetPath = parsed.targetNote
    ? indexer.resolveNotePath(parsed.targetNote, sourceFilePath)
    : sourceFilePath;

  // If note doesn't exist, create it
  if (!targetPath || !fs.existsSync(targetPath)) {
    if (!parsed.targetNote) {
      vscode.window.showErrorMessage('MarkGarden: Invalid link target.');
      return;
    }

    const folder = resolveNewNoteFolder(sourceFilePath);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (err) {
      vscode.window.showErrorMessage(`MarkGarden: Failed to create directory: ${err.message}`);
      return;
    }

    const newFilename = `${parsed.targetNote}.md`;
    targetPath = path.join(folder, newFilename);

    const initialContent = `---\ntitle: "${parsed.targetNote}"\ndate: ${new Date().toISOString()}\n---\n\n# ${parsed.targetNote}\n`;
    try {
      fs.writeFileSync(targetPath, initialContent, 'utf8');
      indexer.handleFileChange(targetPath);
      vscode.window.showInformationMessage(`MarkGarden: Created note "${newFilename}".`);
    } catch (err) {
      vscode.window.showErrorMessage(`MarkGarden: Failed to create note: ${err.message}`);
      return;
    }
  }

  // Open the document
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(doc);

    // If block anchor is present, jump to block
    if (parsed.blockId) {
      const cleanBlockId = parsed.blockId.toLowerCase();
      const targetMeta = indexer.fileIndex.get(targetPath);
      let targetLine = -1;

      if (targetMeta && targetMeta.blockMap && targetMeta.blockMap.has(cleanBlockId)) {
        targetLine = targetMeta.blockMap.get(cleanBlockId).line;
      } else {
        const content = doc.getText();
        const lines = content.split(/\r?\n/);
        const blockRegex = new RegExp(`(?:^|[ \\t]+)\\^${cleanBlockId}[ \\t]*$`, 'i');
        for (let i = 0; i < lines.length; i++) {
          if (blockRegex.test(lines[i])) {
            targetLine = i;
            break;
          }
        }
      }

      if (targetLine !== -1) {
        const pos = new vscode.Position(targetLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        return;
      } else {
        vscode.window.showWarningMessage(`MarkGarden: Block reference "^${parsed.blockId}" not found in "${path.basename(targetPath)}".`);
      }
    }

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
        vscode.window.showWarningMessage(`MarkGarden: Heading "#${parsed.heading}" not found in "${path.basename(targetPath)}".`);
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to open document: ${err.message}`);
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
    vscode.window.showInformationMessage('MarkGarden: Cursor is not on a [[wikilink]].');
    return;
  }

  await navigateWikilink(link.target, editor.document.fileName, indexer);
}

module.exports = {
  findWikilinksInDocument,
  getWikilinkAtPosition,
  resolveNewNoteFolder,
  resolveMediaFilePath,
  navigateWikilink,
  openLinkAtCursor,
  MarkGardenDocumentLinkProvider,
  MarkGardenDefinitionProvider,
  MarkGardenCompletionItemProvider
};
