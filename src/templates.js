const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Format date using custom token replacement.
 * Supported tokens: YYYY, MM, DD, HH, mm, ss, Z
 */
function formatDateTime(date, formatStr) {
  const pad = (num, len = 2) => String(num).padStart(len, '0');
  
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  
  // Timezone offset formatting
  const tzOffset = -date.getTimezoneOffset();
  const diff = tzOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMins = pad(Math.abs(tzOffset) % 60);
  const Z = tzOffset === 0 ? 'Z' : `${diff}${tzHours}:${tzMins}`;
  
  return formatStr
    .replace(/YYYY/g, YYYY)
    .replace(/MM/g, MM)
    .replace(/DD/g, DD)
    .replace(/HH/g, HH)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss)
    .replace(/Z/g, Z);
}

/**
 * Replace placeholders in template content:
 * - {{title}}
 * - {{date}}
 * - {{date:FORMAT}}
 * - {{time}}
 * - {{time:FORMAT}}
 */
function processTemplate(content, filenameWithoutExtension, date = new Date()) {
  let processed = content;
  
  // Replace {{title}}
  processed = processed.replace(/{{title}}/g, filenameWithoutExtension);
  
  // Replace {{date:FORMAT}}
  processed = processed.replace(/{{date:([^}]+)}}/g, (match, formatStr) => {
    return formatDateTime(date, formatStr);
  });
  
  // Replace {{time:FORMAT}}
  processed = processed.replace(/{{time:([^}]+)}}/g, (match, formatStr) => {
    return formatDateTime(date, formatStr);
  });
  
  // Replace simple {{date}}
  processed = processed.replace(/{{date}}/g, formatDateTime(date, 'YYYY-MM-DD'));
  
  // Replace simple {{time}}
  processed = processed.replace(/{{time}}/g, formatDateTime(date, 'HH:mm'));
  
  return processed;
}

/**
 * Simple parser to extract frontmatter metadata from template files
 */
function parseTemplateMetadata(filePath, fileContent) {
  const metadata = {
    title: path.basename(filePath, '.md'),
    description: '',
    tags: []
  };

  const frontmatterMatch = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const yamlLines = frontmatterMatch[1].split('\n');
    for (const line of yamlLines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        let value = parts.slice(1).join(':').trim();
        value = value.replace(/^['"]|['"]$/g, '');
        
        if (key === 'title') {
          metadata.title = value;
        } else if (key === 'description') {
          metadata.description = value;
        } else if (key === 'tags') {
          metadata.tags = value
            .replace(/[[\]]/g, '')
            .split(',')
            .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
            .filter(t => t.length > 0);
        }
      }
    }
  }

  return metadata;
}

/**
 * Get active workspace folder absolute path
 */
function getWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeUri = activeEditor.document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  
  return folders[0].uri.fsPath;
}

/**
 * Command: Insert Template
 */
async function insertTemplate() {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MarkGarden: Please open a workspace folder first.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('MarkGarden: Please open a markdown file or editor to insert a template.');
    return;
  }

  const config = vscode.workspace.getConfiguration('markgarden');
  const templatesFolder = config.get('templatesFolder', 'templates');
  const templatesDir = path.resolve(workspaceRoot, templatesFolder);

  if (!fs.existsSync(templatesDir)) {
    vscode.window.showErrorMessage(`MarkGarden: Templates folder not found at "${templatesDir}". Please verify your settings.`);
    return;
  }

  let files;
  try {
    files = fs.readdirSync(templatesDir).filter(file => file.endsWith('.md'));
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to read templates directory: ${err.message}`);
    return;
  }

  if (files.length === 0) {
    vscode.window.showInformationMessage(`MarkGarden: No templates (.md) found in "${templatesFolder}".`);
    return;
  }

  const quickPickItems = [];
  for (const file of files) {
    const fullPath = path.join(templatesDir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const meta = parseTemplateMetadata(fullPath, content);
      
      let detail = meta.description || 'Template file';
      if (meta.tags.length > 0) {
        detail += ` • Tags: ${meta.tags.join(', ')}`;
      }

      quickPickItems.push({
        label: `$(file-code) ${meta.title}`,
        description: `${templatesFolder}/${file}`,
        detail: detail,
        filePath: fullPath
      });
    } catch {
      quickPickItems.push({
        label: `$(file) ${file}`,
        description: `${templatesFolder}/${file}`,
        detail: 'Template file',
        filePath: fullPath
      });
    }
  }

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: 'Select an Obsidian template to insert...',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return;
  }

  try {
    const templateRaw = fs.readFileSync(selected.filePath, 'utf8');
    const docPath = editor.document.fileName;
    const titleWithoutExt = path.basename(docPath, path.extname(docPath));
    
    const processedContent = processTemplate(templateRaw, titleWithoutExt, new Date());
    
    await editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, processedContent);
    });
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to insert template: ${err.message}`);
  }
}

module.exports = {
  formatDateTime,
  processTemplate,
  parseTemplateMetadata,
  getWorkspaceFolder,
  insertTemplate
};
