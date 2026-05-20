const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// --- Helper Functions ---

/**
 * Format date using custom token replacement
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
        // Strip outer quotes if present
        value = value.replace(/^['"]|['"]$/g, '');
        
        if (key === 'title') {
          metadata.title = value;
        } else if (key === 'description') {
          metadata.description = value;
        } else if (key === 'tags') {
          metadata.tags = value
            .replace(/[\[\]]/g, '')
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
  
  // If there's an active editor, try to find the workspace folder it belongs to
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeUri = activeEditor.document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  
  // Fallback to first folder
  return folders[0].uri.fsPath;
}

// --- Main Commands Implementation ---

/**
 * Command: Create Daily Note
 */
async function createDailyNote() {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a workspace folder first.');
    return;
  }

  // Get Configurations
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const templatesFolder = config.get('templatesFolder', 'templates');
  const dailyNotesFolder = config.get('dailyNotesFolder', '');
  const dailyNoteTemplate = config.get('dailyNoteTemplate', 'daily.md');
  const dateFormat = config.get('dateFormat', 'YYYY-MM-DD');

  const now = new Date();
  const dailyNoteName = formatDateTime(now, dateFormat);
  const dailyNoteFilename = `${dailyNoteName}.md`;
  
  // Resolve paths
  const dailyNoteDir = path.resolve(workspaceRoot, dailyNotesFolder);
  const dailyNotePath = path.join(dailyNoteDir, dailyNoteFilename);

  // Check if daily note exists
  if (fs.existsSync(dailyNotePath)) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dailyNotePath));
    await vscode.window.showTextDocument(doc);
    return;
  }

  // Ensure daily note folder exists
  try {
    fs.mkdirSync(dailyNoteDir, { recursive: true });
  } catch (err) {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to create daily notes directory: ${err.message}`);
    return;
  }

  // Prepare content
  let initialContent = '';
  const templatesDir = path.resolve(workspaceRoot, templatesFolder);
  const templatePath = path.join(templatesDir, dailyNoteTemplate);

  if (fs.existsSync(templatePath)) {
    try {
      const templateRaw = fs.readFileSync(templatePath, 'utf8');
      initialContent = processTemplate(templateRaw, dailyNoteName, now);
    } catch (err) {
      vscode.window.showWarningMessage(`Obsidian Notes: Failed to load/process daily template: ${err.message}`);
      initialContent = `# ${dailyNoteName}\n`;
    }
  } else {
    // Standard default structure if no template is found
    initialContent = `---\ntitle: "${dailyNoteName}"\ndate: ${formatDateTime(now, 'YYYY-MM-DDTHH:mm:ssZ')}\ntags: ["journal"]\n---\n\n# ${dailyNoteName}\n`;
  }

  // Write file and open it
  try {
    fs.writeFileSync(dailyNotePath, initialContent, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dailyNotePath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Obsidian Notes: Created today's daily note: ${dailyNoteFilename}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to write daily note: ${err.message}`);
  }
}

/**
 * Command: Insert Template
 */
async function insertTemplate() {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a workspace folder first.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Obsidian Notes: Please open a markdown file or editor to insert a template.');
    return;
  }

  // Get Configurations
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const templatesFolder = config.get('templatesFolder', 'templates');
  const templatesDir = path.resolve(workspaceRoot, templatesFolder);

  if (!fs.existsSync(templatesDir)) {
    vscode.window.showErrorMessage(`Obsidian Notes: Templates folder not found at "${templatesDir}". Please verify your settings.`);
    return;
  }

  // Read all markdown files from the templates folder
  let files;
  try {
    files = fs.readdirSync(templatesDir).filter(file => file.endsWith('.md'));
  } catch (err) {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to read templates directory: ${err.message}`);
    return;
  }

  if (files.length === 0) {
    vscode.window.showInformationMessage(`Obsidian Notes: No templates (.md) found in "${templatesFolder}".`);
    return;
  }

  // Parse metadata to build a high-fidelity QuickPick menu
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
    } catch (err) {
      // Fallback in case of read error
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
    return; // User canceled
  }

  // Insert template content
  try {
    const templateRaw = fs.readFileSync(selected.filePath, 'utf8');
    
    // Determine active document title (without extension)
    const docPath = editor.document.fileName;
    const titleWithoutExt = path.basename(docPath, path.extname(docPath));
    
    const processedContent = processTemplate(templateRaw, titleWithoutExt, new Date());
    
    // Insert text at current cursor position
    await editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, processedContent);
    });
  } catch (err) {
    vscode.window.showErrorMessage(`Obsidian Notes: Failed to insert template: ${err.message}`);
  }
}

// --- Activation & Deactivation Hooks ---

function activate(context) {
  // Register commands
  const createDailyNoteDisposable = vscode.commands.registerCommand(
    'obsidian-notes.createDailyNote', 
    createDailyNote
  );
  
  const insertTemplateDisposable = vscode.commands.registerCommand(
    'obsidian-notes.insertTemplate', 
    insertTemplate
  );

  context.subscriptions.push(createDailyNoteDisposable);
  context.subscriptions.push(insertTemplateDisposable);

  // Check Startup Option
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const openOnStartup = config.get('openDailyNoteOnStartup', false);
  
  if (openOnStartup) {
    // Delay slightly to ensure workspace is fully settled
    setTimeout(() => {
      vscode.commands.executeCommand('obsidian-notes.createDailyNote');
    }, 1000);
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // Exported for testing
  formatDateTime,
  processTemplate,
  parseTemplateMetadata
};
