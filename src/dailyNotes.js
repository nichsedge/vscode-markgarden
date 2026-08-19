const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { formatDateTime, processTemplate, getWorkspaceFolder } = require('./templates');

/**
 * Command: Create Daily Note
 */
async function createDailyNote() {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MarkGarden: Please open a workspace folder first.');
    return;
  }

  // Get Configurations
  const config = vscode.workspace.getConfiguration('markgarden');
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
    vscode.window.showErrorMessage(`MarkGarden: Failed to create daily notes directory: ${err.message}`);
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
      vscode.window.showWarningMessage(`MarkGarden: Failed to load/process daily template: ${err.message}`);
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
    vscode.window.showInformationMessage(`MarkGarden: Created today's daily note: ${dailyNoteFilename}`);
  } catch (err) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to write daily note: ${err.message}`);
  }
}

module.exports = {
  createDailyNote
};
