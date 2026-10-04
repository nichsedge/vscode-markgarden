import * as vscode from 'vscode';
import { WorkspaceNotesIndexer } from './indexer';
import {
  MarkGardenDocumentLinkProvider,
  MarkGardenDefinitionProvider,
  MarkGardenCompletionItemProvider,
  openLinkAtCursor,
  navigateWikilink
} from './wikilinks';
import {
  TagsTreeDataProvider,
  CategoriesTreeDataProvider,
  MarkGardenHashtagCompletionItemProvider,
  addTagCommand,
  removeTagCommand,
  addCategoryCommand,
  removeCategoryCommand,
  findNotesByTag,
  findNotesByCategory,
  renameTagCommand,
  renameCategoryCommand
} from './tagsCategories';
import { insertTemplate, formatDateTime, processTemplate, parseTemplateMetadata } from './templates';
import { createDailyNote } from './dailyNotes';
import { GraphViewManager } from './graphView';
import { BacklinksTreeDataProvider, convertUnlinkedMentionToWikilinkCommand } from './backlinks';
import { MarkGardenHoverProvider } from './hoverProvider';
import { extractSelectionToNote } from './noteRefactor';

import {
  FrontmatterCompletionProvider,
  registerFrontmatterSaveHandler,
  addPropertyCommand,
  formatFrontmatterCommand,
  renamePropertyWorkspaceCommand,
  convertInlineTagsToFrontmatterCommand,
  syncTitleWithFilenameCommand
} from './frontmatter';

import {
  DigitalGardenTreeDataProvider,
  DigitalGardenStatusBarManager,
  DigitalGardenDiagnosticsProvider,
  togglePublishStatusCommand,
  setGrowthStageCommand,
  runGardenAuditCommand
} from './digitalGarden';

import {
  insertCalloutCommand,
  CalloutEditorDecorator
} from './callouts';

import { registerMarkdownItWikilinks } from './markdownItPlugin';
import { registerMcpSupport } from './mcpProvider';

let indexer: WorkspaceNotesIndexer | null = null;
let graphViewManager: GraphViewManager | null = null;

/**
 * Activates the MarkGarden extension.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize Workspace Indexer
  indexer = new WorkspaceNotesIndexer();
  context.subscriptions.push(indexer);
  // Index in the background so a large vault doesn't block activation:
  // providers and commands are registered immediately and gracefully
  // return empty results while the index is still warming up.
  indexer.initialize(context).catch((err: any) => {
    vscode.window.showErrorMessage(`MarkGarden: Failed to initialize workspace index: ${err.message}`);
  });

  // Initialize Graph View Manager
  graphViewManager = new GraphViewManager(context, indexer);
  context.subscriptions.push(graphViewManager);

  // Markdown document selector
  const markdownSelector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };

  // Register Language Feature Providers
  const docLinkProvider = new MarkGardenDocumentLinkProvider(indexer);
  const defProvider = new MarkGardenDefinitionProvider(indexer);
  const wikilinkCompletionProvider = new MarkGardenCompletionItemProvider(indexer);
  const hashtagCompletionProvider = new MarkGardenHashtagCompletionItemProvider(indexer);
  const frontmatterCompletionProvider = new FrontmatterCompletionProvider(indexer);
  const hoverProvider = new MarkGardenHoverProvider(indexer);

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(markdownSelector, docLinkProvider),
    vscode.languages.registerDefinitionProvider(markdownSelector, defProvider),
    vscode.languages.registerCompletionItemProvider(markdownSelector, wikilinkCompletionProvider, '[', '#', '^', '/', '|'),
    vscode.languages.registerCompletionItemProvider(markdownSelector, hashtagCompletionProvider, '#'),
    vscode.languages.registerCompletionItemProvider(markdownSelector, frontmatterCompletionProvider, ':', ' ', '[', '-', '\n', '#'),
    vscode.languages.registerHoverProvider(markdownSelector, hoverProvider)
  );

  // Register Auto-update Modified Date on Save Handler
  registerFrontmatterSaveHandler(context, indexer);

  // Register Sidebar Tree Views (with proper disposal)
  const backlinksTreeDataProvider = new BacklinksTreeDataProvider(indexer);
  const tagsTreeDataProvider = new TagsTreeDataProvider(indexer);
  const categoriesTreeDataProvider = new CategoriesTreeDataProvider(indexer);
  const digitalGardenTreeDataProvider = new DigitalGardenTreeDataProvider(indexer);

  // Digital Garden UI & Editor Enhancements
  const digitalGardenStatusBarManager = new DigitalGardenStatusBarManager(indexer);
  const digitalGardenDiagnosticsProvider = new DigitalGardenDiagnosticsProvider(indexer);
  const calloutEditorDecorator = new CalloutEditorDecorator();

  // Trigger initial decorations & diagnostics for active editor
  if (vscode.window.activeTextEditor) {
    calloutEditorDecorator.updateDecorations(vscode.window.activeTextEditor);
    digitalGardenDiagnosticsProvider.updateDiagnostics(vscode.window.activeTextEditor.document);
  }

  // Active editor change listener
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      digitalGardenStatusBarManager.update();
      if (editor) {
        calloutEditorDecorator.triggerUpdate(editor);
        digitalGardenDiagnosticsProvider.triggerUpdate(editor.document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document === event.document) {
        calloutEditorDecorator.triggerUpdate(activeEditor);
        digitalGardenDiagnosticsProvider.triggerUpdate(event.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      digitalGardenDiagnosticsProvider.clear(doc.uri);
    })
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('markgarden-backlinks', backlinksTreeDataProvider),
    vscode.window.registerTreeDataProvider('markgarden-tags', tagsTreeDataProvider),
    vscode.window.registerTreeDataProvider('markgarden-categories', categoriesTreeDataProvider),
    vscode.window.registerTreeDataProvider('markgarden-digital-garden', digitalGardenTreeDataProvider),
    backlinksTreeDataProvider,
    tagsTreeDataProvider,
    categoriesTreeDataProvider,
    digitalGardenTreeDataProvider,
    digitalGardenStatusBarManager,
    digitalGardenDiagnosticsProvider,
    calloutEditorDecorator
  );

  // Register embedded MCP server so AI agents (Copilot agent mode, etc.)
  // can answer "what can I do with MarkGarden?" and query the vault.
  registerMcpSupport(context);

  // Register Commands
  const commands = [
    // Daily Notes & Templates
    vscode.commands.registerCommand('markgarden.createDailyNote', createDailyNote),
    vscode.commands.registerCommand('markgarden.insertTemplate', insertTemplate),

    // Frontmatter Management
    vscode.commands.registerCommand('markgarden.addProperty', () => addPropertyCommand(indexer)),
    vscode.commands.registerCommand('markgarden.formatFrontmatter', () => formatFrontmatterCommand()),
    vscode.commands.registerCommand('markgarden.renameProperty', () => renamePropertyWorkspaceCommand(indexer)),
    vscode.commands.registerCommand('markgarden.convertInlineTagsToFrontmatter', () => convertInlineTagsToFrontmatterCommand(indexer)),
    vscode.commands.registerCommand('markgarden.syncTitleWithFilename', () => syncTitleWithFilenameCommand()),

    // Digital Garden Suite
    vscode.commands.registerCommand('markgarden.togglePublishStatus', () => togglePublishStatusCommand(indexer, digitalGardenStatusBarManager, digitalGardenTreeDataProvider)),
    vscode.commands.registerCommand('markgarden.setGrowthStage', () => setGrowthStageCommand(indexer, digitalGardenStatusBarManager, digitalGardenTreeDataProvider)),
    vscode.commands.registerCommand('markgarden.runGardenAudit', () => runGardenAuditCommand(indexer)),
    vscode.commands.registerCommand('markgarden.refreshDigitalGarden', () => digitalGardenTreeDataProvider.refresh()),

    // Obsidian Callouts
    vscode.commands.registerCommand('markgarden.insertCallout', () => insertCalloutCommand()),

    // Graph View
    vscode.commands.registerCommand('markgarden.openGraphView', () => graphViewManager!.openGraphView(false)),
    vscode.commands.registerCommand('markgarden.openLocalGraphView', () => graphViewManager!.openGraphView(true)),

    // Wikilink Navigation
    vscode.commands.registerCommand('markgarden.openLinkAtCursor', () => openLinkAtCursor(indexer)),
    vscode.commands.registerCommand('markgarden.openWikilink', (args: any) => {
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = { target: args };
        }
      }
      const target = args ? args.target : null;
      const sourceFile = args ? args.sourceFile : (vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.fileName : null);
      return navigateWikilink(target, sourceFile, indexer);
    }),

    // Tag Management
    vscode.commands.registerCommand('markgarden.addTag', () => addTagCommand(indexer)),
    vscode.commands.registerCommand('markgarden.removeTag', () => removeTagCommand(indexer)),
    vscode.commands.registerCommand('markgarden.findNotesByTag', () => findNotesByTag(indexer)),
    vscode.commands.registerCommand('markgarden.renameTag', (item: any) => renameTagCommand(indexer, item)),

    // Category Management
    vscode.commands.registerCommand('markgarden.addCategory', () => addCategoryCommand(indexer)),
    vscode.commands.registerCommand('markgarden.removeCategory', () => removeCategoryCommand(indexer)),
    vscode.commands.registerCommand('markgarden.findNotesByCategory', () => findNotesByCategory(indexer)),
    vscode.commands.registerCommand('markgarden.renameCategory', (item: any) => renameCategoryCommand(indexer, item)),

    // Index & Refresh
    vscode.commands.registerCommand('markgarden.refreshIndex', async () => {
      await indexer!.rebuildIndex();
      digitalGardenTreeDataProvider.refresh();
      vscode.window.showInformationMessage('MarkGarden: Refreshed workspace index.');
    }),

    // Backlinks Management
    vscode.commands.registerCommand('markgarden.togglePinBacklinks', () => backlinksTreeDataProvider.togglePin()),
    vscode.commands.registerCommand('markgarden.refreshBacklinks', () => backlinksTreeDataProvider.refresh()),
    vscode.commands.registerCommand('markgarden.convertUnlinkedMentionToWikilink', (item: any) => convertUnlinkedMentionToWikilinkCommand(item, indexer)),

    // Note Refactor & Zettelkasten Extraction
    vscode.commands.registerCommand('markgarden.extractSelectionToNote', () => extractSelectionToNote(indexer))
  ];

  context.subscriptions.push(...commands);

  // Check Startup Option
  const config = vscode.workspace.getConfiguration('markgarden');
  const openOnStartup = config.get<boolean>('openDailyNoteOnStartup', false);

  if (openOnStartup) {
    setTimeout(() => {
      vscode.commands.executeCommand('markgarden.createDailyNote');
    }, 1000);
  }
}

export function deactivate(): void {
  // All disposables are tracked via context.subscriptions and disposed automatically
  // but we also nullify references for GC
  if (graphViewManager) {
    graphViewManager.dispose();
    graphViewManager = null;
  }
  if (indexer) {
    indexer.dispose();
    indexer = null;
  }
}

export function extendMarkdownIt(md: any): any {
  return registerMarkdownItWikilinks(md);
}

export {
  formatDateTime,
  processTemplate,
  parseTemplateMetadata
};
