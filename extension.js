const vscode = require('vscode');
const { WorkspaceNotesIndexer } = require('./src/indexer');
const {
  MarkGardenDocumentLinkProvider,
  MarkGardenDefinitionProvider,
  MarkGardenCompletionItemProvider,
  openLinkAtCursor,
  navigateWikilink
} = require('./src/wikilinks');
const {
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
} = require('./src/tagsCategories');
const { insertTemplate, formatDateTime, processTemplate, parseTemplateMetadata } = require('./src/templates');
const { createDailyNote } = require('./src/dailyNotes');
const { GraphViewManager } = require('./src/graphView');
const { BacklinksTreeDataProvider, convertUnlinkedMentionToWikilinkCommand } = require('./src/backlinks');
const { MarkGardenHoverProvider } = require('./src/hoverProvider');
const { extractSelectionToNote } = require('./src/noteRefactor');

const {
  FrontmatterCompletionProvider,
  registerFrontmatterSaveHandler,
  addPropertyCommand,
  formatFrontmatterCommand,
  renamePropertyWorkspaceCommand,
  convertInlineTagsToFrontmatterCommand,
  syncTitleWithFilenameCommand
} = require('./src/frontmatter');

const {
  DigitalGardenTreeDataProvider,
  DigitalGardenStatusBarManager,
  DigitalGardenDiagnosticsProvider,
  togglePublishStatusCommand,
  setGrowthStageCommand,
  runGardenAuditCommand
} = require('./src/digitalGarden');

const {
  insertCalloutCommand,
  CalloutEditorDecorator
} = require('./src/callouts');

const { registerMarkdownItWikilinks } = require('./src/markdownItPlugin');

let indexer = null;
let graphViewManager = null;

/**
 * Activates the MarkGarden extension.
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
    vscode.commands.registerCommand('markgarden.openGraphView', () => graphViewManager.openGraphView(false)),
    vscode.commands.registerCommand('markgarden.openLocalGraphView', () => graphViewManager.openGraphView(true)),

    // Wikilink Navigation
    vscode.commands.registerCommand('markgarden.openLinkAtCursor', () => openLinkAtCursor(indexer)),
    vscode.commands.registerCommand('markgarden.openWikilink', args => {
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
    vscode.commands.registerCommand('markgarden.renameTag', item => renameTagCommand(indexer, item)),

    // Category Management
    vscode.commands.registerCommand('markgarden.addCategory', () => addCategoryCommand(indexer)),
    vscode.commands.registerCommand('markgarden.removeCategory', () => removeCategoryCommand(indexer)),
    vscode.commands.registerCommand('markgarden.findNotesByCategory', () => findNotesByCategory(indexer)),
    vscode.commands.registerCommand('markgarden.renameCategory', item => renameCategoryCommand(indexer, item)),

    // Index & Refresh
    vscode.commands.registerCommand('markgarden.refreshIndex', () => {
      indexer.rebuildIndex();
      digitalGardenTreeDataProvider.refresh();
      vscode.window.showInformationMessage('MarkGarden: Refreshed workspace index.');
    }),

    // Backlinks Management
    vscode.commands.registerCommand('markgarden.togglePinBacklinks', () => backlinksTreeDataProvider.togglePin()),
    vscode.commands.registerCommand('markgarden.refreshBacklinks', () => backlinksTreeDataProvider.refresh()),
    vscode.commands.registerCommand('markgarden.convertUnlinkedMentionToWikilink', item => convertUnlinkedMentionToWikilinkCommand(item, indexer)),

    // Note Refactor & Zettelkasten Extraction
    vscode.commands.registerCommand('markgarden.extractSelectionToNote', () => extractSelectionToNote(indexer))
  ];

  context.subscriptions.push(...commands);

  // Check Startup Option
  const config = vscode.workspace.getConfiguration('markgarden');
  const openOnStartup = config.get('openDailyNoteOnStartup', false);
  
  if (openOnStartup) {
    setTimeout(() => {
      vscode.commands.executeCommand('markgarden.createDailyNote');
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
