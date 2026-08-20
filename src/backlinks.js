const vscode = require('vscode');
const path = require('path');

class BacklinkTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, type, itemData = null) {
    super(label, collapsibleState);
    this.type = type; // 'section', 'linkedFile', 'unlinkedFile', 'linkedSnippet', 'unlinkedSnippet', 'info'
    this.itemData = itemData;

    if (type === 'section') {
      this.contextValue = 'backlinksSection';
    } else if (type === 'linkedFile') {
      this.contextValue = 'backlinkLinkedFile';
      this.iconPath = new vscode.ThemeIcon('file-symlink-file');
      if (itemData && itemData.sourceFilePath) {
        this.resourceUri = vscode.Uri.file(itemData.sourceFilePath);
      }
    } else if (type === 'unlinkedFile') {
      this.contextValue = 'backlinkUnlinkedFile';
      this.iconPath = new vscode.ThemeIcon('file-search');
      if (itemData && itemData.sourceFilePath) {
        this.resourceUri = vscode.Uri.file(itemData.sourceFilePath);
      }
    } else if (type === 'linkedSnippet') {
      this.contextValue = 'linkedSnippet';
      this.iconPath = new vscode.ThemeIcon('references');
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [
          vscode.Uri.file(itemData.filePath),
          {
            selection: new vscode.Range(itemData.line, 0, itemData.line, 0),
            preview: true
          }
        ]
      };
    } else if (type === 'unlinkedSnippet') {
      this.contextValue = 'unlinkedMentionSnippet';
      this.iconPath = new vscode.ThemeIcon('symbol-keyword');
      this.tooltip = `Click to open, or click 🔗 to convert "${itemData.term}" to wikilink`;
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [
          vscode.Uri.file(itemData.filePath),
          {
            selection: new vscode.Range(itemData.line, 0, itemData.line, 0),
            preview: true
          }
        ]
      };
    }
  }
}

class BacklinksTreeDataProvider {
  constructor(indexer) {
    this.indexer = indexer;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.pinnedFilePath = null;
    this.activeFilePath = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'markdown'
      ? vscode.window.activeTextEditor.document.fileName
      : null;

    this._disposables = [];

    // Listen for editor changes
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
      if (this.pinnedFilePath) return; // Locked to pinned note
      if (editor && editor.document.languageId === 'markdown') {
        if (this.activeFilePath !== editor.document.fileName) {
          this.activeFilePath = editor.document.fileName;
          this.refresh();
        }
      }
    });

    // Listen for index updates
    const indexDisposable = this.indexer.onDidChangeIndex(() => {
      this.refresh();
    });

    this._disposables.push(editorDisposable, indexDisposable, this._onDidChangeTreeData);
  }

  get targetFilePath() {
    return this.pinnedFilePath || this.activeFilePath;
  }

  togglePin() {
    if (this.pinnedFilePath) {
      this.pinnedFilePath = null;
      if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'markdown') {
        this.activeFilePath = vscode.window.activeTextEditor.document.fileName;
      }
      vscode.window.showInformationMessage('Obsidian Backlinks: Unpinned note.');
    } else if (this.activeFilePath) {
      this.pinnedFilePath = this.activeFilePath;
      const targetMeta = this.indexer.fileIndex.get(this.pinnedFilePath);
      const name = targetMeta ? (targetMeta.title || targetMeta.baseName) : path.basename(this.pinnedFilePath);
      vscode.window.showInformationMessage(`Obsidian Backlinks: Pinned to "${name}".`);
    } else {
      vscode.window.showWarningMessage('Obsidian Backlinks: No active markdown note to pin.');
    }
    this.refresh();
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    const targetFile = this.targetFilePath;

    if (!targetFile || !this.indexer.fileIndex.has(targetFile)) {
      if (!element) {
        const item = new BacklinkTreeItem('Open a markdown note to view backlinks', vscode.TreeItemCollapsibleState.None, 'info');
        item.iconPath = new vscode.ThemeIcon('info');
        return [item];
      }
      return [];
    }

    const targetMeta = this.indexer.fileIndex.get(targetFile);
    const targetName = targetMeta ? (targetMeta.title || targetMeta.baseName) : path.basename(targetFile, '.md');

    // Root level
    if (!element) {
      const backlinks = await this.indexer.getBacklinksForFile(targetFile);
      const unlinked = await this.indexer.getUnlinkedMentionsForFile(targetFile);

      const totalLinkedSnippets = backlinks.reduce((sum, b) => sum + b.snippets.length, 0);
      const totalUnlinkedMentions = unlinked.reduce((sum, u) => sum + u.mentions.length, 0);

      const pinSuffix = this.pinnedFilePath ? ' 📌 [Pinned]' : '';

      const linkedSection = new BacklinkTreeItem(
        `🔗 Linked References (${totalLinkedSnippets})`,
        totalLinkedSnippets > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'section',
        { type: 'linkedRoot', data: backlinks }
      );
      linkedSection.description = `Notes linking to ${targetName}${pinSuffix}`;

      const unlinkedSection = new BacklinkTreeItem(
        `🔍 Unlinked Mentions (${totalUnlinkedMentions})`,
        totalUnlinkedMentions > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'section',
        { type: 'unlinkedRoot', data: unlinked }
      );
      unlinkedSection.description = `Notes mentioning ${targetName}${pinSuffix}`;

      return [linkedSection, unlinkedSection];
    }

    // Section level
    if (element.type === 'section') {
      const sectionType = element.itemData.type;
      if (sectionType === 'linkedRoot') {
        const backlinks = element.itemData.data;
        if (backlinks.length === 0) {
          const item = new BacklinkTreeItem('No linked references found', vscode.TreeItemCollapsibleState.None, 'info');
          item.iconPath = new vscode.ThemeIcon('dash');
          return [item];
        }
        return backlinks.map(b => {
          const fileItem = new BacklinkTreeItem(
            b.title,
            vscode.TreeItemCollapsibleState.Expanded,
            'linkedFile',
            b
          );
          fileItem.description = `${b.relativePath} (${b.snippets.length})`;
          return fileItem;
        });
      } else if (sectionType === 'unlinkedRoot') {
        const unlinked = element.itemData.data;
        if (unlinked.length === 0) {
          const item = new BacklinkTreeItem('No unlinked mentions found', vscode.TreeItemCollapsibleState.None, 'info');
          item.iconPath = new vscode.ThemeIcon('dash');
          return [item];
        }
        return unlinked.map(u => {
          const fileItem = new BacklinkTreeItem(
            u.title,
            vscode.TreeItemCollapsibleState.Expanded,
            'unlinkedFile',
            u
          );
          fileItem.description = `${u.relativePath} (${u.mentions.length})`;
          return fileItem;
        });
      }
    }

    // Linked file level -> snippets
    if (element.type === 'linkedFile') {
      const fileData = element.itemData;
      return fileData.snippets.map(s => {
        const snippetItem = new BacklinkTreeItem(
          `L${s.line + 1}: ${s.lineText}`,
          vscode.TreeItemCollapsibleState.None,
          'linkedSnippet',
          {
            filePath: fileData.sourceFilePath,
            line: s.line,
            text: s.lineText
          }
        );
        return snippetItem;
      });
    }

    // Unlinked file level -> mentions
    if (element.type === 'unlinkedFile') {
      const fileData = element.itemData;
      return fileData.mentions.map(m => {
        const snippetItem = new BacklinkTreeItem(
          `L${m.line + 1}: ${m.lineText}`,
          vscode.TreeItemCollapsibleState.None,
          'unlinkedSnippet',
          {
            filePath: fileData.sourceFilePath,
            line: m.line,
            text: m.lineText,
            term: m.term,
            targetNote: m.targetNote
          }
        );
        snippetItem.description = `[Mention: "${m.term}"]`;
        return snippetItem;
      });
    }

    return [];
  }

  dispose() {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}

async function convertUnlinkedMentionToWikilinkCommand(item, indexer) {
  if (!item || !item.itemData) return;
  const { filePath, line, term, targetNote } = item.itemData;

  try {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);

    let targetLine = line;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    let match = null;

    if (targetLine >= 0 && targetLine < doc.lineCount) {
      match = regex.exec(doc.lineAt(targetLine).text);
    }

    if (!match) {
      for (let i = 0; i < doc.lineCount; i++) {
        const m = regex.exec(doc.lineAt(i).text);
        if (m) {
          match = m;
          targetLine = i;
          break;
        }
      }
    }

    if (!match) {
      vscode.window.showWarningMessage(`Could not locate mention "${term}" in ${path.basename(filePath)}.`);
      return;
    }

    const startPos = new vscode.Position(targetLine, match.index);
    const endPos = new vscode.Position(targetLine, match.index + match[0].length);

    let replacement;
    if (term.toLowerCase() === targetNote.toLowerCase()) {
      replacement = `[[${match[0]}]]`;
    } else {
      replacement = `[[${targetNote}|${match[0]}]]`;
    }

    const success = await editor.edit(editBuilder => {
      editBuilder.replace(new vscode.Range(startPos, endPos), replacement);
    });

    if (success) {
      await doc.save();
      if (indexer) {
        indexer.handleFileChange(filePath);
      }
      vscode.window.showInformationMessage(`Converted mention "${match[0]}" to ${replacement} in ${path.basename(filePath)}.`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to convert wikilink: ${err.message}`);
  }
}

module.exports = {
  BacklinksTreeDataProvider,
  convertUnlinkedMentionToWikilinkCommand
};
