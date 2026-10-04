import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { formatDateTime, processTemplate, getWorkspaceFolder } from './templates';

/**
 * Command: Create Daily Note
 */
export async function createDailyNote(): Promise<void> {
  const workspaceRoot = getWorkspaceFolder();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('MarkGarden: Please open a workspace folder first.');
    return;
  }

  // Get Configurations
  const config = vscode.workspace.getConfiguration('markgarden');
  const templatesFolder = config.get<string>('templatesFolder', 'templates');
  const dailyNotesFolder = config.get<string>('dailyNotesFolder', '');
  const dailyNoteTemplate = config.get<string>('dailyNoteTemplate', 'daily.md');
  const dateFormat = config.get<string>('dateFormat', 'YYYY-MM-DD');

  const now = new Date();
  const dailyNoteName = formatDateTime(now, dateFormat);
  const dailyNoteFilename = `${dailyNoteName}.md`;

  // Resolve paths
  const dailyNoteDir = path.resolve(workspaceRoot, dailyNotesFolder);
  const dailyNotePath = path.join(dailyNoteDir, dailyNoteFilename);

  // Check if daily note exists
  let dailyNoteExists = false;
  try {
    await fs.promises.access(dailyNotePath);
    dailyNoteExists = true;
  } catch {
    // does not exist
  }
  if (dailyNoteExists) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dailyNotePath));
    await vscode.window.showTextDocument(doc);
    return;
  }

  // Ensure daily note folder exists
  try {
    await fs.promises.mkdir(dailyNoteDir, { recursive: true });
  } catch (err: any) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to create daily notes directory: ${err.message}`);
    return;
  }

  // Prepare content
  let initialContent = '';
  const templatesDir = path.resolve(workspaceRoot, templatesFolder);
  const templatePath = path.join(templatesDir, dailyNoteTemplate);

  let templateRaw: string | null = null;
  try {
    templateRaw = await fs.promises.readFile(templatePath, 'utf8');
  } catch {
    // template not found or unreadable
  }

  if (templateRaw !== null) {
    try {
      initialContent = processTemplate(templateRaw, dailyNoteName, now);
    } catch (err: any) {
      vscode.window.showWarningMessage(`MarkGarden: Failed to load/process daily template: ${err.message}`);
      initialContent = `# ${dailyNoteName}\n`;
    }
  } else {
    // Standard default structure if no template is found
    initialContent = `---\ntitle: "${dailyNoteName}"\ndate: ${formatDateTime(now, 'YYYY-MM-DDTHH:mm:ssZ')}\ntags: ["journal"]\n---\n\n# ${dailyNoteName}\n`;
  }

  // Write file and open it
  try {
    await fs.promises.writeFile(dailyNotePath, initialContent, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dailyNotePath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`MarkGarden: Created today's daily note: ${dailyNoteFilename}`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`MarkGarden: Failed to write daily note: ${err.message}`);
  }
}
