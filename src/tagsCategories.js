const vscode = require('vscode');
const path = require('path');

// --- Frontmatter Mutation Utilities ---

/**
 * Parses frontmatter bounds from a document text.
 * Returns { hasFrontmatter, startLine, endLine, rawYaml, innerStartIndex, innerEndIndex }
 */
function getFrontmatterBounds(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { hasFrontmatter: false };
  }

  const rawYaml = match[1];
  const fullMatch = match[0];
  const lines = fullMatch.split(/\r?\n/);

  return {
    hasFrontmatter: true,
    rawYaml,
    startLine: 0,
    endLine: lines.length - 1,
    matchLength: fullMatch.length
  };
}

/**
 * Modifies YAML frontmatter content to add or remove an item from a list property (e.g. tags or categories).
 */
function updateYamlListProperty(rawYaml, propKey, itemToAdd, itemToRemove) {
  const lines = rawYaml.split(/\r?\n/);
  let propLineIndex = -1;
  let isListSyntax = false;
  const listItems = [];
  const otherLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    const key = colonIdx !== -1 ? line.slice(0, colonIdx).trim().toLowerCase() : '';

    if (key === propKey || key === (propKey === 'tags' ? 'tag' : 'category')) {
      propLineIndex = i;
      const valuePart = line.slice(colonIdx + 1).trim();

      // Check if bracketed "[item1, item2]"
      if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
        const cleaned = valuePart.slice(1, -1);
        cleaned.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(x => listItems.push(x));
      } else if (valuePart) {
        valuePart.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(x => listItems.push(x));
      } else {
        // Multi-line list syntax
        isListSyntax = true;
        // Collect following lines starting with "-"
        let j = i + 1;
        while (j < lines.length && /^\s*-\s*/.test(lines[j])) {
          const val = lines[j].replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
          if (val) listItems.push(val);
          j++;
        }
        i = j - 1; // skip collected lines
      }
    } else {
      otherLines.push(line);
    }
  }

  const itemSet = new Set(listItems);
  if (itemToAdd) {
    itemSet.add(itemToAdd);
  }
  if (itemToRemove) {
    itemSet.delete(itemToRemove);
  }

  const updatedItems = Array.from(itemSet);
  const formattedProp = `${propKey}: [${updatedItems.map(t => `"${t}"`).join(', ')}]`;

  // Reassemble YAML
  if (propLineIndex === -1) {
    if (updatedItems.length > 0) {
      return (rawYaml.trim() ? rawYaml.trim() + '\n' : '') + formattedProp;
    }
    return rawYaml;
  }

  if (updatedItems.length === 0) {
    return otherLines.join('\n');
  }

  const resultLines = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    const key = colonIdx !== -1 ? line.slice(0, colonIdx).trim().toLowerCase() : '';

    if (key === propKey || key === (propKey === 'tags' ? 'tag' : 'category')) {
      if (!inserted) {
        resultLines.push(formattedProp);
        inserted = true;
      }
      if (isListSyntax) {
        while (i + 1 < lines.length && /^\s*-\s*/.test(lines[i + 1])) {
          i++;
        }
      }
    } else {
      resultLines.push(line);
    }
  }

  return resultLines.join('\n');
}

/**
 * Adds a tag to a markdown document string (in frontmatter or as an inline hashtag).
 */
function addTagToMarkdown(content, tag, isInline = false) {
  const cleanTag = tag.replace(/^#/, '').trim();
  if (!cleanTag) return content;

  if (isInline) {
    return content.trimEnd() + `\n\n#${cleanTag}\n`;
  }

  const bounds = getFrontmatterBounds(content);
  if (!bounds.hasFrontmatter) {
    return `---\ntags: ["${cleanTag}"]\n---\n\n${content}`;
  }

  const newYaml = updateYamlListProperty(bounds.rawYaml, 'tags', cleanTag, null);
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
}

/**
 * Removes a tag from markdown document string.
 */
function removeTagFromMarkdown(content, tag) {
  const cleanTag = tag.replace(/^#/, '').trim();
  if (!cleanTag) return content;

  let result = content;
  const bounds = getFrontmatterBounds(content);
  if (bounds.hasFrontmatter) {
    const newYaml = updateYamlListProperty(bounds.rawYaml, 'tags', null, cleanTag);
    result = result.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
  }

  // Also remove inline #tag if present
  const escapedTag = cleanTag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const inlineRegex = new RegExp(`(^|\\s)#${escapedTag}(?=[\\s.,:;!?\\])]|$)`, 'g');
  result = result.replace(inlineRegex, '$1').replace(/\n\s*\n\s*\n/g, '\n\n');

  return result;
}

/**
 * Adds a category to markdown document string in frontmatter.
 */
function addCategoryToMarkdown(content, category) {
  const cleanCat = category.trim();
  if (!cleanCat) return content;

  const bounds = getFrontmatterBounds(content);
  if (!bounds.hasFrontmatter) {
    return `---\ncategories: ["${cleanCat}"]\n---\n\n${content}`;
  }

  const newYaml = updateYamlListProperty(bounds.rawYaml, 'categories', cleanCat, null);
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
}

/**
 * Removes a category from markdown document string.
 */
function removeCategoryFromMarkdown(content, category) {
  const cleanCat = category.trim();
  if (!cleanCat) return content;

  const bounds = getFrontmatterBounds(content);
  if (!bounds.hasFrontmatter) return content;

  const newYaml = updateYamlListProperty(bounds.rawYaml, 'categories', null, cleanCat);
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
}

/**
 * Renames a tag in markdown content (both frontmatter and inline hashtags).
 */
function renameTagInMarkdown(content, oldTag, newTag) {
  const cleanOld = oldTag.replace(/^#/, '').trim();
  const cleanNew = newTag.replace(/^#/, '').trim();
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return content;

  let result = content;
  const bounds = getFrontmatterBounds(content);

  if (bounds.hasFrontmatter) {
    const newYaml = updateYamlListProperty(bounds.rawYaml, 'tags', cleanNew, cleanOld);
    result = result.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
  }

  // Replace inline hashtag: `#oldTag` or `#oldTag/subtag`
  const escapedOld = cleanOld.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const inlineRegex = new RegExp(`(^|\\s)#${escapedOld}(?=[\\s.,:;!?\\]/)]|$)`, 'g');
  result = result.replace(inlineRegex, `$1#${cleanNew}`);

  return result;
}

/**
 * Renames a category in markdown frontmatter.
 */
function renameCategoryInMarkdown(content, oldCategory, newCategory) {
  const cleanOld = oldCategory.trim();
  const cleanNew = newCategory.trim();
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return content;

  const bounds = getFrontmatterBounds(content);
  if (!bounds.hasFrontmatter) return content;

  const newYaml = updateYamlListProperty(bounds.rawYaml, 'categories', cleanNew, cleanOld);
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newYaml}\n---`);
}

// --- Tree Data Providers ---

/**
 * TreeDataProvider for Tags sidebar view.
 */
class TagsTreeDataProvider {
  constructor(indexer) {
    this.indexer = indexer;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.indexer.onDidChangeIndex(() => this.refresh());
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    if (element.type === 'tag') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('tag');
      item.description = `(${element.count})`;
      item.contextValue = 'obsidianTag';
      return item;
    } else if (element.type === 'note') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('markdown');
      item.description = element.relativePath;
      item.command = {
        command: 'vscode.open',
        title: 'Open Note',
        arguments: [vscode.Uri.file(element.filePath)]
      };
      item.contextValue = 'obsidianTagNote';
      return item;
    }
  }

  getChildren(element) {
    if (!element) {
      const tags = this.indexer.getAllTags();
      return tags.map(t => ({
        type: 'tag',
        name: t.tag,
        count: t.count,
        files: t.files
      }));
    }

    if (element.type === 'tag') {
      return element.files.map(filePath => {
        const meta = this.indexer.fileIndex.get(filePath);
        return {
          type: 'note',
          name: meta ? meta.title : path.basename(filePath, '.md'),
          relativePath: meta ? meta.relativePath : path.basename(filePath),
          filePath
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    }

    return [];
  }
}

/**
 * TreeDataProvider for Categories sidebar view.
 */
class CategoriesTreeDataProvider {
  constructor(indexer) {
    this.indexer = indexer;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.indexer.onDidChangeIndex(() => this.refresh());
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    if (element.type === 'category') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `(${element.count})`;
      item.contextValue = 'obsidianCategory';
      return item;
    } else if (element.type === 'note') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('markdown');
      item.description = element.relativePath;
      item.command = {
        command: 'vscode.open',
        title: 'Open Note',
        arguments: [vscode.Uri.file(element.filePath)]
      };
      item.contextValue = 'obsidianCategoryNote';
      return item;
    }
  }

  getChildren(element) {
    if (!element) {
      const categories = this.indexer.getAllCategories();
      return categories.map(c => ({
        type: 'category',
        name: c.category,
        count: c.count,
        files: c.files
      }));
    }

    if (element.type === 'category') {
      return element.files.map(filePath => {
        const meta = this.indexer.fileIndex.get(filePath);
        return {
          type: 'note',
          name: meta ? meta.title : path.basename(filePath, '.md'),
          relativePath: meta ? meta.relativePath : path.basename(filePath),
          filePath
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    }

    return [];
  }
}

// --- Autocompletion Provider for #hashtags ---

/**
 * Suggests workspace #tags when typing # in markdown notes.
 */
class ObsidianHashtagCompletionItemProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideCompletionItems(document, position) {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substr(0, position.character);

    // Skip if this line is a markdown header e.g. # Header or ## Header
    if (/^[ \t]*#{1,6}[ \t]/.test(prefix)) {
      return undefined;
    }

    const lastHash = prefix.lastIndexOf('#');
    if (lastHash === -1) return undefined;

    // Verify hash is preceded by whitespace or start of line
    if (lastHash > 0 && !/\s/.test(prefix[lastHash - 1])) {
      return undefined;
    }

    const tags = this.indexer.getAllTags();
    return tags.map(t => {
      const item = new vscode.CompletionItem(t.tag, vscode.CompletionItemKind.Keyword);
      item.detail = `Tag (${t.count} notes)`;
      item.insertText = t.tag;
      return item;
    });
  }
}

// --- Command Handlers ---

/**
 * Command: Add Tag to Current Note
 */
async function addTagCommand(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a markdown file first.');
    return;
  }

  const existingTags = indexer.getAllTags().map(t => t.tag);
  const tagInput = await vscode.window.showInputBox({
    placeHolder: 'e.g. project/alpha, research, daily',
    prompt: `Enter tag name to add (Existing tags: ${existingTags.slice(0, 5).join(', ')}${existingTags.length > 5 ? '...' : ''})`,
    validateInput: val => val.trim().length === 0 ? 'Tag name cannot be empty.' : null
  });

  if (!tagInput) return;
  const tag = tagInput.trim().replace(/^#/, '');

  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const tagPrefix = config.get('tagPrefix', 'frontmatter');
  const isInline = tagPrefix === 'inline';

  const currentContent = editor.document.getText();
  const newContent = addTagToMarkdown(currentContent, tag, isInline);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(currentContent.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, newContent);
  });

  vscode.window.showInformationMessage(`Obsidian Notes: Added tag "#${tag}".`);
}

/**
 * Command: Remove Tag from Current Note
 */
async function removeTagCommand(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a markdown file first.');
    return;
  }

  const meta = indexer.fileIndex.get(editor.document.fileName);
  const tags = meta ? Array.from(meta.tags) : [];

  if (tags.length === 0) {
    vscode.window.showInformationMessage('Obsidian Notes: No tags found in the current note.');
    return;
  }

  const selected = await vscode.window.showQuickPick(tags, {
    placeHolder: 'Select a tag to remove from this note...'
  });

  if (!selected) return;

  const currentContent = editor.document.getText();
  const newContent = removeTagFromMarkdown(currentContent, selected);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(currentContent.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, newContent);
  });

  vscode.window.showInformationMessage(`Obsidian Notes: Removed tag "#${selected}".`);
}

/**
 * Command: Add Category to Current Note
 */
async function addCategoryCommand(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a markdown file first.');
    return;
  }

  const existingCategories = indexer.getAllCategories().map(c => c.category);
  const categoryInput = await vscode.window.showInputBox({
    placeHolder: 'e.g. Work, Journal, Personal, Archive',
    prompt: `Enter category name (Existing categories: ${existingCategories.slice(0, 5).join(', ')}${existingCategories.length > 5 ? '...' : ''})`,
    validateInput: val => val.trim().length === 0 ? 'Category name cannot be empty.' : null
  });

  if (!categoryInput) return;
  const category = categoryInput.trim();

  const currentContent = editor.document.getText();
  const newContent = addCategoryToMarkdown(currentContent, category);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(currentContent.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, newContent);
  });

  vscode.window.showInformationMessage(`Obsidian Notes: Added category "${category}".`);
}

/**
 * Command: Remove Category from Current Note
 */
async function removeCategoryCommand(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a markdown file first.');
    return;
  }

  const meta = indexer.fileIndex.get(editor.document.fileName);
  const categories = meta ? Array.from(meta.categories) : [];

  if (categories.length === 0) {
    vscode.window.showInformationMessage('Obsidian Notes: No categories found in the current note.');
    return;
  }

  const selected = await vscode.window.showQuickPick(categories, {
    placeHolder: 'Select a category to remove from this note...'
  });

  if (!selected) return;

  const currentContent = editor.document.getText();
  const newContent = removeCategoryFromMarkdown(currentContent, selected);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(currentContent.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, newContent);
  });

  vscode.window.showInformationMessage(`Obsidian Notes: Removed category "${selected}".`);
}

/**
 * Command: Find Notes by Tag
 */
async function findNotesByTag(indexer) {
  const tags = indexer.getAllTags();
  if (tags.length === 0) {
    vscode.window.showInformationMessage('Obsidian Notes: No tags indexed in workspace.');
    return;
  }

  const tagPickItems = tags.map(t => ({
    label: `$(tag) #${t.tag}`,
    description: `${t.count} ${t.count === 1 ? 'note' : 'notes'}`,
    tag: t
  }));

  const selectedTag = await vscode.window.showQuickPick(tagPickItems, {
    placeHolder: 'Select a tag to view matching notes...'
  });

  if (!selectedTag) return;

  const noteItems = selectedTag.tag.files.map(filePath => {
    const meta = indexer.fileIndex.get(filePath);
    return {
      label: `$(file) ${meta ? meta.title : path.basename(filePath, '.md')}`,
      description: meta ? meta.relativePath : path.basename(filePath),
      filePath
    };
  });

  const selectedNote = await vscode.window.showQuickPick(noteItems, {
    placeHolder: `Notes tagged with #${selectedTag.tag.tag}...`
  });

  if (selectedNote) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(selectedNote.filePath));
    await vscode.window.showTextDocument(doc);
  }
}

/**
 * Command: Find Notes by Category
 */
async function findNotesByCategory(indexer) {
  const categories = indexer.getAllCategories();
  if (categories.length === 0) {
    vscode.window.showInformationMessage('Obsidian Notes: No categories indexed in workspace.');
    return;
  }

  const catPickItems = categories.map(c => ({
    label: `$(folder) ${c.category}`,
    description: `${c.count} ${c.count === 1 ? 'note' : 'notes'}`,
    category: c
  }));

  const selectedCat = await vscode.window.showQuickPick(catPickItems, {
    placeHolder: 'Select a category to view matching notes...'
  });

  if (!selectedCat) return;

  const noteItems = selectedCat.category.files.map(filePath => {
    const meta = indexer.fileIndex.get(filePath);
    return {
      label: `$(file) ${meta ? meta.title : path.basename(filePath, '.md')}`,
      description: meta ? meta.relativePath : path.basename(filePath),
      filePath
    };
  });

  const selectedNote = await vscode.window.showQuickPick(noteItems, {
    placeHolder: `Notes categorized as "${selectedCat.category.category}"...`
  });

  if (selectedNote) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(selectedNote.filePath));
    await vscode.window.showTextDocument(doc);
  }
}

/**
 * Command: Batch Rename Tag across Workspace
 */
async function renameTagCommand(indexer, treeItem) {
  let targetTag = treeItem && treeItem.name ? treeItem.name : null;

  if (!targetTag) {
    const tags = indexer.getAllTags();
    if (tags.length === 0) {
      vscode.window.showInformationMessage('Obsidian Notes: No tags found to rename.');
      return;
    }

    const selected = await vscode.window.showQuickPick(tags.map(t => ({
      label: `#${t.tag}`,
      description: `(${t.count} notes)`,
      tag: t.tag
    })), {
      placeHolder: 'Select a tag to rename across workspace...'
    });

    if (!selected) return;
    targetTag = selected.tag;
  }

  const newTagInput = await vscode.window.showInputBox({
    value: targetTag,
    prompt: `Enter new tag name for #${targetTag}:`,
    validateInput: val => {
      const clean = val.trim().replace(/^#/, '');
      if (!clean) return 'Tag name cannot be empty.';
      if (clean === targetTag) return 'New tag name must be different.';
      return null;
    }
  });

  if (!newTagInput) return;
  const newTag = newTagInput.trim().replace(/^#/, '');

  const files = indexer.tagIndex.get(targetTag);
  if (!files || files.size === 0) {
    vscode.window.showInformationMessage(`Obsidian Notes: No files found with tag #${targetTag}.`);
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const filePath of files) {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const originalText = doc.getText();
      const modifiedText = renameTagInMarkdown(originalText, targetTag, newTag);

      if (originalText !== modifiedText) {
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length));
        workspaceEdit.replace(uri, fullRange, modifiedText);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Obsidian Notes: Failed to prepare rename for ${filePath}: ${err.message}`);
    }
  }

  const success = await vscode.workspace.applyEdit(workspaceEdit);
  if (success) {
    vscode.window.showInformationMessage(`Obsidian Notes: Renamed #${targetTag} to #${newTag} across ${files.size} notes.`);
  } else {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to apply batch rename for #${targetTag}.`);
  }
}

/**
 * Command: Batch Rename Category across Workspace
 */
async function renameCategoryCommand(indexer, treeItem) {
  let targetCategory = treeItem && treeItem.name ? treeItem.name : null;

  if (!targetCategory) {
    const categories = indexer.getAllCategories();
    if (categories.length === 0) {
      vscode.window.showInformationMessage('Obsidian Notes: No categories found to rename.');
      return;
    }

    const selected = await vscode.window.showQuickPick(categories.map(c => ({
      label: `${c.category}`,
      description: `(${c.count} notes)`,
      category: c.category
    })), {
      placeHolder: 'Select a category to rename across workspace...'
    });

    if (!selected) return;
    targetCategory = selected.category;
  }

  const newCategoryInput = await vscode.window.showInputBox({
    value: targetCategory,
    prompt: `Enter new category name for "${targetCategory}":`,
    validateInput: val => {
      const clean = val.trim();
      if (!clean) return 'Category name cannot be empty.';
      if (clean === targetCategory) return 'New category name must be different.';
      return null;
    }
  });

  if (!newCategoryInput) return;
  const newCategory = newCategoryInput.trim();

  const files = indexer.categoryIndex.get(targetCategory);
  if (!files || files.size === 0) {
    vscode.window.showInformationMessage(`Obsidian Notes: No files found with category "${targetCategory}".`);
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const filePath of files) {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const originalText = doc.getText();
      const modifiedText = renameCategoryInMarkdown(originalText, targetCategory, newCategory);

      if (originalText !== modifiedText) {
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(originalText.length));
        workspaceEdit.replace(uri, fullRange, modifiedText);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Obsidian Notes: Failed to prepare rename for ${filePath}: ${err.message}`);
    }
  }

  const success = await vscode.workspace.applyEdit(workspaceEdit);
  if (success) {
    vscode.window.showInformationMessage(`Obsidian Notes: Renamed category "${targetCategory}" to "${newCategory}" across ${files.size} notes.`);
  } else {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to apply batch rename for "${targetCategory}".`);
  }
}

module.exports = {
  TagsTreeDataProvider,
  CategoriesTreeDataProvider,
  ObsidianHashtagCompletionItemProvider,
  addTagCommand,
  removeTagCommand,
  addCategoryCommand,
  removeCategoryCommand,
  findNotesByTag,
  findNotesByCategory,
  renameTagCommand,
  renameCategoryCommand,
  // Exported for testing
  getFrontmatterBounds,
  updateYamlListProperty,
  addTagToMarkdown,
  removeTagFromMarkdown,
  addCategoryToMarkdown,
  removeCategoryFromMarkdown,
  renameTagInMarkdown,
  renameCategoryInMarkdown
};
