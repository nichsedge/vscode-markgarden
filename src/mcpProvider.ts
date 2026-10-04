/**
 * MCP Server Definition Provider for MarkGarden.
 *
 * Registers an embedded stdio MCP server with VS Code (Copilot agent mode etc.)
 * so AI assistants automatically gain access to MarkGarden-aware tools:
 * a full help/guide tool plus vault query tools (notes, tags, categories, search).
 *
 * Requires VS Code >= 1.101 (vscode.lm.registerMcpServerDefinitionProvider).
 * On older hosts this is a no-op.
 */
import * as path from 'path';
import * as vscode from 'vscode';

const PROVIDER_ID = 'markgarden.mcpServer';
const SERVER_LABEL = 'MarkGarden';

/**
 * Register the MCP server definition provider.
 * Safe to call on any VS Code version — silently skips unsupported hosts.
 */
export function registerMcpSupport(context: vscode.ExtensionContext): vscode.Disposable | null {
  const lm = (vscode as any).lm;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== 'function') {
    return null;
  }

  const provider = lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    provideMcpServerDefinitions: () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        return [];
      }
      const serverModule = path.join(context.extensionPath, 'dist', 'mcpServer.js');
      return [
        new (vscode as any).McpStdioServerDefinition(
          SERVER_LABEL,
          process.execPath, // the same Node binary VS Code ships with
          [serverModule],
          { MARKGARDEN_WORKSPACE: folders[0].uri.fsPath },
          context.extension.packageJSON.version
        )
      ];
    },
    resolveMcpServerDefinition: async (server: any) => server
  });

  context.subscriptions.push(provider);
  return provider;
}
