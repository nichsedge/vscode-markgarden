const vscode = require('vscode');
const { WorkspaceNotesIndexer } = require('./src/indexer');
const {
  ObsidianDocumentLinkProvider,
  ObsidianDefinitionProvider,
  ObsidianCompletionItemProvider,
  openLinkAtCursor,
  navigateWikilink
} = require('./src/wikilinks');
const {
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
  renameCategoryCommand
} = require('./src/tagsCategories');
const { insertTemplate, formatDateTime, processTemplate, parseTemplateMetadata } = require('./src/templates');
const { createDailyNote } = require('./src/dailyNotes');
const { GraphViewManager } = require('./src/graphView');
const { BacklinksTreeDataProvider, convertUnlinkedMentionToWikilinkCommand } = require('./src/backlinks');
const { ObsidianHoverProvider } = require('./src/hoverProvider');
const { extractSelectionToNote } = require('./src/noteRefactor');

const { registerMarkdownItWikilinks } = require('./src/markdownItPlugin');

let indexer = null;
let graphViewManager = null;

/**
 * Activates the Obsidian Notes extension.
 */
async function activate(context) {
  // Initialize Workspace Indexer
  indexer = new WorkspaceNotesIndexer();
  await indexer.initialize(context);
  context.subscriptions.push(indexer);

  // Initialize Graph View Manager
  graphViewManager = new GraphViewManager(context, indexer);
  context.subscriptions.push(graphViewManager);

  // Markdown document selector
  const markdownSelector = { language: 'markdown', scheme: 'file' };

  // Register Language Feature Providers
  const docLinkProvider = new ObsidianDocumentLinkProvider(indexer);
  const defProvider = new ObsidianDefinitionProvider(indexer);
  const wikilinkCompletionProvider = new ObsidianCompletionItemProvider(indexer);
  const hashtagCompletionProvider = new ObsidianHashtagCompletionItemProvider(indexer);
  const hoverProvider = new ObsidianHoverProvider(indexer);

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(markdownSelector, docLinkProvider),
    vscode.languages.registerDefinitionProvider(markdownSelector, defProvider),
    vscode.languages.registerCompletionItemProvider(markdownSelector, wikilinkCompletionProvider, '['),
    vscode.languages.registerCompletionItemProvider(markdownSelector, hashtagCompletionProvider, '#'),
    vscode.languages.registerHoverProvider(markdownSelector, hoverProvider)
  );

  // Register Sidebar Tree Views (with proper disposal)
  const backlinksTreeDataProvider = new BacklinksTreeDataProvider(indexer);
  const tagsTreeDataProvider = new TagsTreeDataProvider(indexer);
  const categoriesTreeDataProvider = new CategoriesTreeDataProvider(indexer);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('obsidian-notes-backlinks', backlinksTreeDataProvider),
    vscode.window.registerTreeDataProvider('obsidian-notes-tags', tagsTreeDataProvider),
    vscode.window.registerTreeDataProvider('obsidian-notes-categories', categoriesTreeDataProvider),
    backlinksTreeDataProvider,
    tagsTreeDataProvider,
    categoriesTreeDataProvider
  );

  // Register Commands
  const commands = [
    // Daily Notes & Templates
    vscode.commands.registerCommand('obsidian-notes.createDailyNote', createDailyNote),
    vscode.commands.registerCommand('obsidian-notes.insertTemplate', insertTemplate),

    // Graph View
    vscode.commands.registerCommand('obsidian-notes.openGraphView', () => graphViewManager.openGraphView(false)),
    vscode.commands.registerCommand('obsidian-notes.openLocalGraphView', () => graphViewManager.openGraphView(true)),

    // Wikilink Navigation
    vscode.commands.registerCommand('obsidian-notes.openLinkAtCursor', () => openLinkAtCursor(indexer)),
    vscode.commands.registerCommand('obsidian-notes.openWikilink', args => {
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
    vscode.commands.registerCommand('obsidian-notes.addTag', () => addTagCommand(indexer)),
    vscode.commands.registerCommand('obsidian-notes.removeTag', () => removeTagCommand(indexer)),
    vscode.commands.registerCommand('obsidian-notes.findNotesByTag', () => findNotesByTag(indexer)),
    vscode.commands.registerCommand('obsidian-notes.renameTag', item => renameTagCommand(indexer, item)),

    // Category Management
    vscode.commands.registerCommand('obsidian-notes.addCategory', () => addCategoryCommand(indexer)),
    vscode.commands.registerCommand('obsidian-notes.removeCategory', () => removeCategoryCommand(indexer)),
    vscode.commands.registerCommand('obsidian-notes.findNotesByCategory', () => findNotesByCategory(indexer)),
    vscode.commands.registerCommand('obsidian-notes.renameCategory', item => renameCategoryCommand(indexer, item)),

    // Index & Refresh
    vscode.commands.registerCommand('obsidian-notes.refreshIndex', () => {
      indexer.rebuildIndex();
      vscode.window.showInformationMessage('Obsidian Notes: Refreshed workspace index.');
    }),

    // Backlinks Management
    vscode.commands.registerCommand('obsidian-notes.togglePinBacklinks', () => backlinksTreeDataProvider.togglePin()),
    vscode.commands.registerCommand('obsidian-notes.refreshBacklinks', () => backlinksTreeDataProvider.refresh()),
    vscode.commands.registerCommand('obsidian-notes.convertUnlinkedMentionToWikilink', item => convertUnlinkedMentionToWikilinkCommand(item, indexer)),

    // Note Refactor & Zettelkasten Extraction
    vscode.commands.registerCommand('obsidian-notes.extractSelectionToNote', () => extractSelectionToNote(indexer))
  ];

  context.subscriptions.push(...commands);

  // Check Startup Option
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const openOnStartup = config.get('openDailyNoteOnStartup', false);
  
  if (openOnStartup) {
    setTimeout(() => {
      vscode.commands.executeCommand('obsidian-notes.createDailyNote');
    }, 1000);
  }
}

function deactivate() {
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

module.exports = {
  activate,
  deactivate,
  extendMarkdownIt(md) {
    return registerMarkdownItWikilinks(md);
  },
  formatDateTime,
  processTemplate,
  parseTemplateMetadata
};
