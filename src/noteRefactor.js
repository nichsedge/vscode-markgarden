const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { resolveNewNoteFolder } = require('./wikilinks');

/**
 * Derives a clean default note title from selected markdown text.
 */
function deriveDefaultTitle(selectionText) {
  if (!selectionText) return 'Untitled Note';

  const lines = selectionText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return 'Untitled Note';

  const firstLine = lines[0];

  // Match heading "# Heading Title"
  const headingMatch = firstLine.match(/^#{1,6}[ \t]+(.+)$/);
  if (headingMatch) {
    return headingMatch[1].trim().replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled Note';
  }

  // Clean bullet points, task boxes, blockquotes
  let cleanLine = firstLine
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^>\s+/, '')
    .replace(/[`*_~[\]]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  if (cleanLine.length > 50) {
    cleanLine = cleanLine.substring(0, 50).trim();
  }

  return cleanLine || 'Untitled Note';
}

/**
 * Generates frontmatter and body for the extracted note.
 */
function generateRefactoredNoteContent(title, selectionText, sourceNoteName, dateStr = new Date().toISOString()) {
  const sourceLink = sourceNoteName ? `\nsource: "[[${sourceNoteName}]]"` : '';
  const frontmatter = `---\ntitle: "${title}"\ndate: ${dateStr}${sourceLink}\n---\n\n`;

  const trimmedSelection = selectionText.trim();
  const startsWithHeading = /^#{1,6}\s+/i.test(trimmedSelection);

  if (startsWithHeading) {
    return frontmatter + trimmedSelection + '\n';
  }

  return frontmatter + `# ${title}\n\n` + trimmedSelection + '\n';
}

/**
 * Command: Extract Selection to New Note (Zettelkasten Refactor)
 */
async function extractSelectionToNote(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown note to extract text.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('MarkGarden: Please select text to extract into a new note.');
    return;
  }

  const selectionText = editor.document.getText(selection);
  const defaultTitle = deriveDefaultTitle(selectionText);

  // 1. Prompt for Note Title
  const title = await vscode.window.showInputBox({
    prompt: 'Enter title for the extracted note',
    value: defaultTitle,
    validateInput: val => {
      if (!val || !val.trim()) return 'Title cannot be empty';
      if (/[\\/:*?"<>|]/.test(val)) return 'Title cannot contain invalid file characters (/ \\ : * ? " < > |)';
      return null;
    }
  });

  if (!title) return;

  // 2. Prompt for replacement mode
  const modeItems = [
    {
      label: `[[${title}]]`,
      description: 'Replace selection with a wikilink',
      mode: 'link'
    },
    {
      label: `![[${title}]]`,
      description: 'Replace selection with an embedded transclusion',
      mode: 'embed'
    },
    {
      label: `[[${title}|Custom Alias]]`,
      description: 'Replace selection with a wikilink and custom alias',
      mode: 'alias'
    },
    {
      label: 'Do not replace',
      description: 'Create note without modifying the selection in source note',
      mode: 'none'
    }
  ];

  const chosenMode = await vscode.window.showQuickPick(modeItems, {
    placeHolder: 'Select how to link the extracted note in the current document'
  });

  if (!chosenMode) return;

  let replacementText = '';
  if (chosenMode.mode === 'link') {
    replacementText = `[[${title}]]`;
  } else if (chosenMode.mode === 'embed') {
    replacementText = `![[${title}]]`;
  } else if (chosenMode.mode === 'alias') {
    const alias = await vscode.window.showInputBox({
      prompt: 'Enter alias for the wikilink',
      value: title
    });
    if (alias === undefined) return;
    replacementText = alias && alias !== title ? `[[${title}|${alias}]]` : `[[${title}]]`;
  }

  // 3. Resolve destination path and save note
  const sourceDocPath = editor.document.fileName;
  const sourceNoteName = path.basename(sourceDocPath, '.md');
  const targetFolder = resolveNewNoteFolder(sourceDocPath);

  try {
    fs.mkdirSync(targetFolder, { recursive: true });
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to create folder: ${err.message}`);
    return;
  }

  const targetPath = path.join(targetFolder, `${title}.md`);
  if (fs.existsSync(targetPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Note "${title}.md" already exists. Overwrite?`,
      { modal: true },
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') return;
  }

  const newNoteContent = generateRefactoredNoteContent(title, selectionText, sourceNoteName);

  try {
    fs.writeFileSync(targetPath, newNoteContent, 'utf8');
    if (indexer) {
      indexer.handleFileChange(targetPath);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to write file: ${err.message}`);
    return;
  }

  // 4. Replace selection in source document if requested
  if (chosenMode.mode !== 'none') {
    await editor.edit(editBuilder => {
      editBuilder.replace(selection, replacementText);
    });
  }

  const openAction = await vscode.window.showInformationMessage(
    `MarkGarden: Extracted selection to "${title}.md".`,
    'Open Note'
  );

  if (openAction === 'Open Note') {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(doc);
  }
}

module.exports = {
  extractSelectionToNote,
  deriveDefaultTitle,
  generateRefactoredNoteContent
};
