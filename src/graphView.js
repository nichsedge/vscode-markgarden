const vscode = require('vscode');
const path = require('path');

class GraphViewManager {
  constructor(context, indexer) {
    this.context = context;
    this.indexer = indexer;
    this.panel = null;
    this.isLocal = false;
    this.localDepth = 1;
    this.activeFilePath = null;
    this._disposables = [];
    this._panelDisposables = [];
    this._cachedTagList = null;
    this._cachedCategoryList = null;
    this._indexDirty = true;

    // Listen to index changes to live-update graph
    const indexDisposable = this.indexer.onDidChangeIndex(() => {
      this._indexDirty = true;
      this._cachedTagList = null;
      this._cachedCategoryList = null;
      if (this.panel) {
        this.sendGraphData();
      }
    });
    this._disposables.push(indexDisposable);

    // Listen to active editor changes for Local Graph mode
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'markdown') {
        this.activeFilePath = editor.document.fileName;
        if (this.panel && this.isLocal) {
          this.sendGraphData();
        }
      }
    });
    this._disposables.push(editorDisposable);
  }

  _clearPanelDisposables() {
    for (const d of this._panelDisposables) {
      d.dispose();
    }
    this._panelDisposables.length = 0;
  }

  /**
   * Opens or reveals the Graph View webview panel.
   */
  openGraphView(isLocal = false) {
    this.isLocal = isLocal;

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'markdown') {
      this.activeFilePath = activeEditor.document.fileName;
    }

    const column = activeEditor && activeEditor.viewColumn
      ? activeEditor.viewColumn === vscode.ViewColumn.One
        ? vscode.ViewColumn.Two
        : activeEditor.viewColumn
      : vscode.ViewColumn.One;

    if (this.panel) {
      this.panel.reveal(column);
      this.panel.title = this.isLocal ? 'Obsidian Local Graph' : 'Obsidian Graph View';
      this.sendGraphData();
      return;
    }

    this._clearPanelDisposables();

    this.panel = vscode.window.createWebviewPanel(
      'obsidianGraphView',
      this.isLocal ? 'Obsidian Local Graph' : 'Obsidian Graph View',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
        ]
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'obsidian.svg')),
      dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'obsidian.svg'))
    };

    this.panel.webview.html = this.getWebviewContent();

    const messageDisposable = this.panel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'openNote': {
          if (message.filePath) {
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.filePath));
              await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            } catch (err) {
              vscode.window.showErrorMessage(`Obsidian Notes: Failed to open note: ${err.message}`);
            }
          }
          break;
        }
        case 'requestData': {
          this.sendGraphData();
          break;
        }
        case 'setMode': {
          this.isLocal = !!message.isLocal;
          if (message.depth) {
            this.localDepth = message.depth;
          }
          this.panel.title = this.isLocal ? 'Obsidian Local Graph' : 'Obsidian Graph View';
          this.sendGraphData();
          break;
        }
        case 'saveSettings': {
          if (message.settings && this.context && this.context.workspaceState) {
            this.context.workspaceState.update('obsidianGraphSettings', message.settings);
          }
          break;
        }
        case 'resetSettings': {
          if (this.context && this.context.workspaceState) {
            this.context.workspaceState.update('obsidianGraphSettings', undefined);
          }
          break;
        }
      }
    });

    const disposeDisposable = this.panel.onDidDispose(() => {
      this._clearPanelDisposables();
      this.panel = null;
    });

    this._panelDisposables.push(messageDisposable, disposeDisposable);

    this.sendGraphData();
  }

  /**
   * Sends the computed graph data to the Webview.
   */
  sendGraphData() {
    if (!this.panel) return;

    const data = this.indexer.getGraphData(
      this.isLocal ? this.activeFilePath : null,
      this.isLocal ? this.localDepth : 0
    );

    // Use cached tag/category lists when index hasn't changed
    if (this._indexDirty || !this._cachedTagList) {
      this._cachedTagList = this.indexer.getAllTags().map(t => t.tag);
      this._cachedCategoryList = this.indexer.getAllCategories().map(c => c.category);
      this._indexDirty = false;
    }

    const savedSettings = (this.context && this.context.workspaceState)
      ? this.context.workspaceState.get('obsidianGraphSettings') || null
      : null;

    this.panel.webview.postMessage({
      command: 'updateGraph',
      data,
      isLocal: this.isLocal,
      localDepth: this.localDepth,
      activeNoteTitle: this.activeFilePath ? path.basename(this.activeFilePath, '.md') : '',
      allTags: this._cachedTagList,
      allCategories: this._cachedCategoryList,
      excludedTags: Array.from(this.indexer.getExcludedTags()),
      savedSettings
    });
  }

  /**
   * Disposes all resources held by the GraphViewManager.
   */
  dispose() {
    this._clearPanelDisposables();

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;

    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }

    this._cachedTagList = null;
    this._cachedCategoryList = null;
  }

  /**
   * Generates the self-contained HTML/CSS/JS for the Graph View Webview.
   */
  getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Obsidian Graph View</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e2e);
      --fg: var(--vscode-editor-foreground, #cdd6f4);
      --card-bg: var(--vscode-sideBar-background, #181825);
      --card-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
      --accent: var(--vscode-focusBorder, #89b4fa);
      --accent-glow: rgba(137, 180, 250, 0.4);
      --input-bg: var(--vscode-input-background, #181825);
      --input-fg: var(--vscode-input-foreground, var(--fg));
      --input-border: var(--vscode-input-border, var(--card-border));
      --dropdown-bg: var(--vscode-dropdown-background, #1e1e2e);
      --dropdown-fg: var(--vscode-dropdown-foreground, var(--fg));
      --dropdown-border: var(--vscode-dropdown-border, var(--card-border));
      --tooltip-bg: var(--vscode-editorHoverWidget-background, #11111b);
      --tooltip-fg: var(--vscode-editorHoverWidget-foreground, var(--fg));
      --tooltip-border: var(--vscode-editorHoverWidget-border, var(--card-border));
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      user-select: none;
    }

    #canvas-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      cursor: grab;
    }

    #canvas-container:active {
      cursor: grabbing;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Floating Glassmorphic Control Panel */
    .controls-panel {
      position: absolute;
      top: 16px;
      left: 16px;
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 290px;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 10;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .controls-panel::-webkit-scrollbar {
      width: 4px;
    }
    .controls-panel::-webkit-scrollbar-thumb {
      background: var(--card-border);
      border-radius: 4px;
    }

    .controls-panel.collapsed {
      width: auto;
      padding: 8px 12px;
      overflow: hidden;
    }

    .controls-panel.collapsed .panel-body {
      display: none;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
    }

    .panel-header .title {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-icon {
      background: transparent;
      border: none;
      color: var(--fg);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.15s, background 0.15s;
    }

    .btn-icon:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .panel-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .input-group label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.7;
    }

    input[type="text"] {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
      width: 100%;
      transition: border-color 0.15s;
    }

    input[type="text"]::placeholder {
      color: var(--input-fg);
      opacity: 0.5;
    }

    select {
      background-color: var(--dropdown-bg);
      color: var(--dropdown-fg);
      border: 1px solid var(--dropdown-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
      width: 100%;
      cursor: pointer;
      transition: border-color 0.15s;
    }

    select option {
      background-color: var(--dropdown-bg);
      color: var(--dropdown-fg);
      padding: 4px 8px;
    }

    input[type="text"]:focus, select:focus {
      border-color: var(--accent);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 34px;
      height: 18px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(255, 255, 255, 0.2);
      transition: .2s;
      border-radius: 18px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 12px;
      width: 12px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: var(--accent);
    }

    input:checked + .slider:before {
      transform: translateX(16px);
    }

    .range-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .range-header {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      opacity: 0.7;
    }

    input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent);
      cursor: pointer;
    }

    .accordion-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      padding: 4px 0;
      opacity: 0.8;
      border-top: 1px solid var(--card-border);
      padding-top: 8px;
    }

    .accordion-header:hover {
      opacity: 1;
    }

    .accordion-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 4px;
    }

    .accordion-content.collapsed {
      display: none;
    }

    .btn-row {
      display: flex;
      gap: 6px;
    }

    .btn-action {
      flex: 1;
      background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
      border: 1px solid var(--card-border);
      border-radius: 6px;
      color: var(--vscode-button-secondaryForeground, var(--fg));
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-action:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.15));
      border-color: var(--accent);
    }

    .stats-badge {
      font-size: 11px;
      opacity: 0.6;
      text-align: center;
      padding-top: 4px;
      border-top: 1px solid var(--card-border);
    }

    /* Floating Tooltip */
    #tooltip {
      position: absolute;
      display: none;
      pointer-events: none;
      background: var(--tooltip-bg);
      backdrop-filter: blur(8px);
      border: 1px solid var(--tooltip-border);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
      color: var(--tooltip-fg);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      z-index: 20;
      max-width: 260px;
      transition: opacity 0.1s ease;
    }

    #tooltip .tooltip-title {
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
      font-size: 13px;
    }

    #tooltip .tooltip-path {
      font-size: 10px;
      opacity: 0.6;
      margin-bottom: 6px;
      word-break: break-all;
    }

    #tooltip .tooltip-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
      opacity: 0.85;
    }

    .tag-pill {
      display: inline-block;
      background: rgba(137, 180, 250, 0.2);
      color: var(--accent);
      border-radius: 4px;
      padding: 1px 4px;
      font-size: 10px;
      margin-right: 3px;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div id="canvas-container">
    <canvas id="graph-canvas"></canvas>
  </div>

  <div class="controls-panel" id="controls-panel">
    <div class="panel-header">
      <div class="title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        <span id="panel-title-text">Graph View</span>
      </div>
      <button class="btn-icon" id="btn-toggle-panel" title="Minimize Controls">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <div class="input-group">
        <input type="text" id="search-input" placeholder="Search (-tag:#anime, tag:#work)..." />
      </div>

      <div class="input-group">
        <select id="tag-filter">
          <option value="">Filter by Tag: All</option>
        </select>
      </div>

      <div class="input-group">
        <select id="tag-exclude-filter">
          <option value="">Exclude Tag: None</option>
        </select>
      </div>

      <div class="input-group">
        <select id="label-mode">
          <option value="smart">Labels: Smart (Hover & Zoom)</option>
          <option value="hover">Labels: Only On Hover</option>
          <option value="always">Labels: Always Visible</option>
        </select>
      </div>

      <div class="toggle-row">
        <span>Show Tags</span>
        <label class="switch">
          <input type="checkbox" id="toggle-tags">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <span>Show Attachments</span>
        <label class="switch">
          <input type="checkbox" id="toggle-attachments">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <span>Show Orphans</span>
        <label class="switch">
          <input type="checkbox" id="toggle-orphans" checked>
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <span>Local Graph</span>
        <label class="switch">
          <input type="checkbox" id="toggle-local">
          <span class="slider"></span>
        </label>
      </div>

      <div class="range-row" id="local-depth-container" style="display: none;">
        <div class="range-header">
          <span>Neighbor Depth</span>
          <span id="depth-val">1</span>
        </div>
        <input type="range" id="range-depth" min="1" max="4" value="1" />
      </div>

      <div class="accordion-header" id="forces-header">
        <span>Forces</span>
        <svg id="forces-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      <div class="accordion-content collapsed" id="forces-content">
        <div class="range-row">
          <div class="range-header">
            <span>Center force</span>
            <span id="center-force-val">100%</span>
          </div>
          <input type="range" id="range-center-force" min="0" max="300" value="100" />
        </div>

        <div class="range-row">
          <div class="range-header">
            <span>Repel force</span>
            <span id="repel-force-val">100%</span>
          </div>
          <input type="range" id="range-repel-force" min="20" max="300" value="100" />
        </div>

        <div class="range-row">
          <div class="range-header">
            <span>Link force</span>
            <span id="link-force-val">100%</span>
          </div>
          <input type="range" id="range-link-force" min="10" max="300" value="100" />
        </div>

        <div class="range-row">
          <div class="range-header">
            <span>Link distance</span>
            <span id="link-dist-val">70px</span>
          </div>
          <input type="range" id="range-link-dist" min="20" max="250" value="70" />
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-action" id="btn-reset-view" title="Fit graph to view">Fit View</button>
        <button class="btn-action" id="btn-toggle-physics">Pause</button>
        <button class="btn-action" id="btn-reset-filters" title="Reset all filters and physics forces to defaults">Reset</button>
      </div>

      <div class="stats-badge" id="stats-badge">0 notes • 0 links</div>
    </div>
  </div>

  <div id="tooltip">
    <div class="tooltip-title" id="tt-title">Note Title</div>
    <div class="tooltip-path" id="tt-path">folder/note.md</div>
    <div class="tooltip-meta" id="tt-meta"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Canvas & Context
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');

    // UI Elements
    const searchInput = document.getElementById('search-input');
    const tagFilter = document.getElementById('tag-filter');
    const tagExcludeFilter = document.getElementById('tag-exclude-filter');
    const labelModeSelect = document.getElementById('label-mode');
    const toggleTags = document.getElementById('toggle-tags');
    const toggleAttachments = document.getElementById('toggle-attachments');
    const toggleOrphans = document.getElementById('toggle-orphans');
    const toggleLocal = document.getElementById('toggle-local');
    const localDepthContainer = document.getElementById('local-depth-container');
    const rangeDepth = document.getElementById('range-depth');
    const depthVal = document.getElementById('depth-val');
    const forcesHeader = document.getElementById('forces-header');
    const forcesContent = document.getElementById('forces-content');
    const forcesArrow = document.getElementById('forces-arrow');
    const rangeCenterForce = document.getElementById('range-center-force');
    const centerForceVal = document.getElementById('center-force-val');
    const rangeRepelForce = document.getElementById('range-repel-force');
    const repelForceVal = document.getElementById('repel-force-val');
    const rangeLinkForce = document.getElementById('range-link-force');
    const linkForceVal = document.getElementById('link-force-val');
    const rangeLinkDist = document.getElementById('range-link-dist');
    const linkDistVal = document.getElementById('link-dist-val');
    const btnResetView = document.getElementById('btn-reset-view');
    const btnTogglePhysics = document.getElementById('btn-toggle-physics');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const btnTogglePanel = document.getElementById('btn-toggle-panel');
    const controlsPanel = document.getElementById('controls-panel');
    const statsBadge = document.getElementById('stats-badge');
    const tooltip = document.getElementById('tooltip');
    const ttTitle = document.getElementById('tt-title');
    const ttPath = document.getElementById('tt-path');
    const ttMeta = document.getElementById('tt-meta');

    // State
    let rawNodes = [];
    let rawLinks = [];
    let nodes = [];
    let links = [];
    let nodeMap = new Map();

    let isLocalMode = false;
    let localDepth = 1;
    let showTags = false;
    let showAttachments = false;
    let showOrphans = true;
    let labelMode = 'smart'; // 'smart' | 'hover' | 'always'
    let searchQuery = '';
    let parsedSearch = null;
    let selectedTag = '';
    let selectedExcludeTag = '';
    let configExcludedTags = [];
    let physicsRunning = true;
    let hasRestoredInitialSettings = false;
    let lastRenderedTagsKey = '';

    // Physics multipliers
    let centerForceMultiplier = 1.0;
    let repelForceMultiplier = 1.0;
    let linkForceMultiplier = 1.0;
    let userLinkDistance = 70;

    // View Transformation (Pan & Zoom)
    let transform = { x: 0, y: 0, scale: 1 };
    let isDraggingCanvas = false;
    let dragStart = { x: 0, y: 0 };
    let hoveredNode = null;
    let draggedNode = null;

    // Render loop control
    let animationFrameId = null;
    let isPageVisible = true;
    let needsRender = true;
    let physicsSettledFrames = 0;
    const SETTLE_THRESHOLD = 150;

    // Reusable Set for highlight detection
    const highlightedNodeIds = new Set();

    // --- State Persistence & Reset Logic ---
    function getCurrentState() {
      return {
        searchQuery,
        selectedTag,
        selectedExcludeTag,
        labelMode,
        showTags,
        showAttachments,
        showOrphans,
        centerForceMultiplier,
        repelForceMultiplier,
        linkForceMultiplier,
        userLinkDistance
      };
    }

    function saveState() {
      const state = getCurrentState();
      try {
        vscode.setState(state);
        vscode.postMessage({
          command: 'saveSettings',
          settings: state
        });
      } catch (e) {
        // ignore
      }
    }

    function restoreState(saved) {
      if (!saved) return;
      if (typeof saved.searchQuery === 'string') {
        searchQuery = saved.searchQuery;
        searchInput.value = searchQuery;
        parsedSearch = parseSearchQuery(searchQuery);
      }
      if (typeof saved.selectedTag === 'string') {
        selectedTag = saved.selectedTag;
        tagFilter.value = selectedTag;
      }
      if (typeof saved.selectedExcludeTag === 'string') {
        selectedExcludeTag = saved.selectedExcludeTag;
        tagExcludeFilter.value = selectedExcludeTag;
      }
      if (typeof saved.labelMode === 'string') {
        labelMode = saved.labelMode;
        labelModeSelect.value = labelMode;
      }
      if (typeof saved.showTags === 'boolean') {
        showTags = saved.showTags;
        toggleTags.checked = showTags;
      }
      if (typeof saved.showAttachments === 'boolean') {
        showAttachments = saved.showAttachments;
        toggleAttachments.checked = showAttachments;
      }
      if (typeof saved.showOrphans === 'boolean') {
        showOrphans = saved.showOrphans;
        toggleOrphans.checked = showOrphans;
      }
      if (typeof saved.centerForceMultiplier === 'number') {
        centerForceMultiplier = saved.centerForceMultiplier;
        const val = Math.round(centerForceMultiplier * 100);
        rangeCenterForce.value = val;
        centerForceVal.textContent = val + '%';
      }
      if (typeof saved.repelForceMultiplier === 'number') {
        repelForceMultiplier = saved.repelForceMultiplier;
        const val = Math.round(repelForceMultiplier * 100);
        rangeRepelForce.value = val;
        repelForceVal.textContent = val + '%';
      }
      if (typeof saved.linkForceMultiplier === 'number') {
        linkForceMultiplier = saved.linkForceMultiplier;
        const val = Math.round(linkForceMultiplier * 100);
        rangeLinkForce.value = val;
        linkForceVal.textContent = val + '%';
      }
      if (typeof saved.userLinkDistance === 'number') {
        userLinkDistance = saved.userLinkDistance;
        rangeLinkDist.value = userLinkDistance;
        linkDistVal.textContent = userLinkDistance + 'px';
      }
    }

    function resetFilters() {
      searchQuery = '';
      searchInput.value = '';
      parsedSearch = null;

      selectedTag = '';
      tagFilter.value = '';

      selectedExcludeTag = '';
      tagExcludeFilter.value = '';

      labelMode = 'smart';
      labelModeSelect.value = 'smart';

      showTags = false;
      toggleTags.checked = false;

      showAttachments = false;
      toggleAttachments.checked = false;

      showOrphans = true;
      toggleOrphans.checked = true;

      centerForceMultiplier = 1.0;
      rangeCenterForce.value = 100;
      centerForceVal.textContent = '100%';

      repelForceMultiplier = 1.0;
      rangeRepelForce.value = 100;
      repelForceVal.textContent = '100%';

      linkForceMultiplier = 1.0;
      rangeLinkForce.value = 100;
      linkForceVal.textContent = '100%';

      userLinkDistance = 70;
      rangeLinkDist.value = 70;
      linkDistVal.textContent = '70px';

      saveState();
      try {
        vscode.postMessage({ command: 'resetSettings' });
      } catch (e) {
        // ignore
      }

      applyFilters();
      fitView();
    }

    // Try immediate restore from Webview session state
    try {
      const initialSaved = vscode.getState();
      if (initialSaved) {
        restoreState(initialSaved);
        hasRestoredInitialSettings = true;
      }
    } catch (e) {
      // ignore
    }

    // Tag Color Palette Generator
    const tagColors = [
      '#89b4fa', '#a6e3a1', '#f9e2af', '#fab387', '#eba0ac',
      '#f38ba8', '#cba6f7', '#94e2d5', '#74c7ec', '#b4befe'
    ];

    function getTagColor(tags) {
      if (!tags || tags.length === 0) return '#89b4fa';
      let hash = 0;
      const tagStr = tags[0];
      for (let i = 0; i < tagStr.length; i++) {
        hash = (hash << 5) - hash + tagStr.charCodeAt(i);
        hash |= 0;
      }
      return tagColors[Math.abs(hash) % tagColors.length];
    }

    // --- Search Query Parser ---
    function parseSearchQuery(query) {
      if (!query || !query.trim()) return null;
      const tokens = query.match(/(?:[^\\s"]+|"[^"]*")+/g) || [];
      const positiveTags = [];
      const negativeTags = [];
      const positivePaths = [];
      const negativePaths = [];
      const positiveTerms = [];
      const negativeTerms = [];

      for (let raw of tokens) {
        const token = raw.replace(/^"|"$/g, '').trim();
        if (!token) continue;

        if (token.startsWith('-tag:')) {
          const val = token.slice(5).replace(/^#/, '').toLowerCase();
          if (val) negativeTags.push(val);
        } else if (token.startsWith('tag:')) {
          const val = token.slice(4).replace(/^#/, '').toLowerCase();
          if (val) positiveTags.push(val);
        } else if (token.startsWith('-path:')) {
          const val = token.slice(6).toLowerCase();
          if (val) negativePaths.push(val);
        } else if (token.startsWith('path:')) {
          const val = token.slice(5).toLowerCase();
          if (val) positivePaths.push(val);
        } else if (token.startsWith('-') && token.length > 1) {
          const val = token.slice(1).toLowerCase();
          if (val) negativeTerms.push(val);
        } else {
          positiveTerms.push(token.toLowerCase());
        }
      }

      return {
        positiveTags,
        negativeTags,
        positivePaths,
        negativePaths,
        positiveTerms,
        negativeTerms,
        isEmpty: !positiveTags.length && !negativeTags.length && !positivePaths.length &&
                 !negativePaths.length && !positiveTerms.length && !negativeTerms.length
      };
    }

    function doesNodeMatchSearch(node, parsedSearch) {
      if (!parsedSearch || parsedSearch.isEmpty) return true;

      const nodeTags = node.tagsLower || (node.tagsLower = (node.tags || []).map(t => t.toLowerCase()));
      const labelLower = node.labelLower || (node.labelLower = (node.label || '').toLowerCase());
      const pathLower = node.pathLower || (node.pathLower = (node.relativePath || node.filePath || '').toLowerCase());

      // Negative tag exclusions
      for (const negTag of parsedSearch.negativeTags) {
        if (nodeTags.includes(negTag)) return false;
      }

      // Positive tag inclusions
      for (const posTag of parsedSearch.positiveTags) {
        if (!nodeTags.includes(posTag)) return false;
      }

      // Negative path exclusions
      for (const negPath of parsedSearch.negativePaths) {
        if (pathLower.includes(negPath)) return false;
      }

      // Positive path inclusions
      for (const posPath of parsedSearch.positivePaths) {
        if (!pathLower.includes(posPath)) return false;
      }

      // Negative text exclusions
      for (const negTerm of parsedSearch.negativeTerms) {
        if (labelLower.includes(negTerm) || pathLower.includes(negTerm)) return false;
      }

      // Positive text inclusions
      for (const posTerm of parsedSearch.positiveTerms) {
        if (!labelLower.includes(posTerm) && !pathLower.includes(posTerm)) return false;
      }

      return true;
    }

    // Resize Canvas
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      requestRender();
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- Render Loop Control ---
    function requestRender() {
      needsRender = true;
      physicsSettledFrames = 0;
      startRenderLoop();
    }

    function startRenderLoop() {
      if (animationFrameId !== null || !isPageVisible) return;
      animationFrameId = requestAnimationFrame(renderLoop);
    }

    function stopRenderLoop() {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    document.addEventListener('visibilitychange', () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) {
        requestRender();
      } else {
        stopRenderLoop();
      }
    });

    // --- Force Simulation Engine ---
    function initializeSimulation() {
      const width = container.clientWidth;
      const height = container.clientHeight;

      // Use a golden ratio spiral layout for initial distribution so nodes don't start overlapping
      const spreadRadius = Math.max(width, height) * 0.45 * Math.sqrt(Math.max(1, nodes.length / 40));
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.x === undefined || node.y === undefined) {
          const phi = i * 2.3999632; // golden angle
          const r = spreadRadius * Math.sqrt(i / Math.max(1, nodes.length));
          node.x = width / 2 + r * Math.cos(phi) + (Math.random() - 0.5) * 15;
          node.y = height / 2 + r * Math.sin(phi) + (Math.random() - 0.5) * 15;
          node.vx = 0;
          node.vy = 0;
        }
        node.radius = Math.max(3.5, Math.min(14, 3.5 + Math.sqrt(node.linkCount || 0) * 2.0));
      }
      requestRender();
    }

    function stepPhysics() {
      if (!physicsRunning && !draggedNode) return false;

      const width = container.clientWidth;
      const height = container.clientHeight;
      const cx = width / 2;
      const cy = height / 2;

      // Center force (adaptive center gravity)
      const centerGravity = (nodes.length > 500
        ? Math.max(0.0003, 0.003 / Math.sqrt(nodes.length))
        : 0.0035) * centerForceMultiplier;

      // Repel force (Coulomb repulsion)
      const baseRepulsion = (nodes.length > 500
        ? Math.max(350, 2200 / Math.sqrt(nodes.length / 50))
        : 1400) * repelForceMultiplier;

      // Link force and Link distance
      const linkStrength = 0.045 * linkForceMultiplier;
      const linkDistance = userLinkDistance;
      const damping = 0.88;

      // 1. Center gravity force
      if (centerGravity > 0) {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node === draggedNode) continue;
          node.vx += (cx - node.x) * centerGravity;
          node.vy += (cy - node.y) * centerGravity;
        }
      }

      // 2. Coulomb Repulsion between nodes (spatial hash for large graphs)
      const maxDistanceSq = nodes.length > 500 ? 160000 : 640000;
      if (nodes.length <= 80) {
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const n2 = nodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const distSq = dx * dx + dy * dy + 150;
            if (distSq > maxDistanceSq) continue;

            const dist = Math.sqrt(distSq);
            const force = baseRepulsion / distSq;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (n1 !== draggedNode) {
              n1.vx -= fx;
              n1.vy -= fy;
            }
            if (n2 !== draggedNode) {
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }
      } else {
        const cellSize = Math.sqrt(maxDistanceSq);
        const invCellSize = 1 / cellSize;
        const grid = new Map();

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const gx = Math.floor(node.x * invCellSize);
          const gy = Math.floor(node.y * invCellSize);
          const key = (gx << 16) ^ (gy & 0xffff);
          let bucket = grid.get(key);
          if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
          }
          bucket.push(node);
          node._gx = gx;
          node._gy = gy;
        }

        const neighborOffsets = [
          [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
        ];

        for (const [key, cellNodes] of grid.entries()) {
          const firstNode = cellNodes[0];
          const gx = firstNode._gx;
          const gy = firstNode._gy;

          // 1. Within cell pairs
          for (let i = 0; i < cellNodes.length; i++) {
            const n1 = cellNodes[i];
            for (let j = i + 1; j < cellNodes.length; j++) {
              const n2 = cellNodes[j];
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const distSq = dx * dx + dy * dy + 150;
              if (distSq > maxDistanceSq) continue;

              const dist = Math.sqrt(distSq);
              const force = baseRepulsion / distSq;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              if (n1 !== draggedNode) {
                n1.vx -= fx;
                n1.vy -= fy;
              }
              if (n2 !== draggedNode) {
                n2.vx += fx;
                n2.vy += fy;
              }
            }
          }

          // 2. Neighboring cells (half neighborhood to test each cell pair once)
          for (let o = 1; o < neighborOffsets.length; o++) {
            const ngx = gx + neighborOffsets[o][0];
            const ngy = gy + neighborOffsets[o][1];
            const nKey = (ngx << 16) ^ (ngy & 0xffff);
            const neighborCell = grid.get(nKey);
            if (!neighborCell) continue;

            for (let i = 0; i < cellNodes.length; i++) {
              const n1 = cellNodes[i];
              for (let j = 0; j < neighborCell.length; j++) {
                const n2 = neighborCell[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const distSq = dx * dx + dy * dy + 150;
                if (distSq > maxDistanceSq) continue;

                const dist = Math.sqrt(distSq);
                const force = baseRepulsion / distSq;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                if (n1 !== draggedNode) {
                  n1.vx -= fx;
                  n1.vy -= fy;
                }
                if (n2 !== draggedNode) {
                  n2.vx += fx;
                  n2.vy += fy;
                }
              }
            }
          }
        }
      }

      // 3. Link Spring Force
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const source = typeof link.source === 'object' ? link.source : nodeMap.get(link.source);
        const target = typeof link.target === 'object' ? link.target : nodeMap.get(link.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - linkDistance;
        const force = displacement * linkStrength;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (source !== draggedNode) {
          source.vx += fx;
          source.vy += fy;
        }
        if (target !== draggedNode) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      // 4. Velocity integration & damping
      const maxVel = 10;
      let totalEnergy = 0;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node === draggedNode) continue;
        node.vx = Math.max(-maxVel, Math.min(maxVel, node.vx * damping));
        node.vy = Math.max(-maxVel, Math.min(maxVel, node.vy * damping));
        node.x += node.vx;
        node.y += node.vy;
        totalEnergy += node.vx * node.vx + node.vy * node.vy;
      }

      return totalEnergy > 0.02;
    }

    // Helper to draw a rounded pill badge
    function drawPill(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    // --- Render Loop ---
    function renderLoop() {
      animationFrameId = null;

      const physicsActive = stepPhysics();

      const width = container.clientWidth;
      const height = container.clientHeight;

      ctx.clearRect(0, 0, width, height);
      ctx.save();

      // Apply Pan & Zoom
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);

      // Build highlighted neighbor set
      highlightedNodeIds.clear();
      if (hoveredNode) {
        highlightedNodeIds.add(hoveredNode.id);
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const sId = typeof l.source === 'object' ? l.source.id : l.source;
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          if (sId === hoveredNode.id) highlightedNodeIds.add(tId);
          if (tId === hoveredNode.id) highlightedNodeIds.add(sId);
        }
      }

      // Render Links
      const minLineWidth = 0.5 / transform.scale;
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const source = typeof link.source === 'object' ? link.source : nodeMap.get(link.source);
        const target = typeof link.target === 'object' ? link.target : nodeMap.get(link.target);
        if (!source || !target) continue;

        const isHighlighted = hoveredNode && (source === hoveredNode || target === hoveredNode);
        const isDimmed = hoveredNode && !isHighlighted;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        if (isHighlighted) {
          ctx.strokeStyle = '#cba6f7';
          ctx.lineWidth = Math.max(minLineWidth * 2.2, 2.2 / transform.scale);
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(180, 190, 254, 0.04)';
          ctx.lineWidth = Math.max(minLineWidth * 0.8, 0.7 / transform.scale);
        } else {
          ctx.strokeStyle = link.type === 'tag'
            ? 'rgba(250, 179, 135, 0.25)'
            : link.type === 'attachment'
              ? 'rgba(137, 220, 235, 0.25)'
              : 'rgba(180, 190, 254, 0.22)';
          ctx.lineWidth = Math.max(minLineWidth, 1 / transform.scale);
        }

        ctx.stroke();
      }

      const minScreenRadius = 2.5;
      const minWorldRadius = minScreenRadius / transform.scale;

      // 1. Draw All Node Dots First
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isHovered = node === hoveredNode;
        const isConnected = highlightedNodeIds.has(node.id);
        const matchesSearch = doesNodeMatchSearch(node, parsedSearch);
        const isDimmed = (hoveredNode && !isConnected) || (!matchesSearch);

        let nodeColor = node.isCurrent ? '#f9e2af' : getTagColor(node.tags);
        if (node.type === 'tag') {
          nodeColor = '#fab387'; // Peach for tags
        } else if (node.type === 'attachment') {
          nodeColor = '#89dceb'; // Cyan for media
        }

        const baseRadius = Math.max(node.radius || 3.5, minWorldRadius);
        const radius = isHovered ? baseRadius * 1.35 : baseRadius;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);

        if (isDimmed) {
          ctx.fillStyle = 'rgba(108, 112, 134, 0.18)';
        } else {
          ctx.fillStyle = nodeColor;
        }
        ctx.fill();

        // Node outline/glow for hovered or current
        if (isHovered || node.isCurrent) {
          ctx.lineWidth = Math.max(1 / transform.scale, (isHovered ? 2.5 : 1.8) / transform.scale);
          ctx.strokeStyle = isHovered ? '#ffffff' : '#f9e2af';
          ctx.stroke();
        }
      }

      // 2. Draw Node Labels (Level of Detail Decluttering)
      const fontWorldSize = Math.max(9, Math.min(13, 11 / transform.scale));
      ctx.font = '500 ' + fontWorldSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isHovered = node === hoveredNode;
        const isConnected = highlightedNodeIds.has(node.id);
        const matchesSearch = doesNodeMatchSearch(node, parsedSearch);
        const isDimmed = (hoveredNode && !isConnected) || (!matchesSearch);

        if (isDimmed) continue;

        let shouldShowLabel = false;
        if (isHovered || isConnected || node.isCurrent || (parsedSearch && !parsedSearch.isEmpty && matchesSearch)) {
          shouldShowLabel = true;
        } else if (labelMode === 'always') {
          shouldShowLabel = true;
        } else if (labelMode === 'smart') {
          shouldShowLabel = transform.scale >= 1.05;
        }

        if (!shouldShowLabel) continue;

        const baseRadius = Math.max(node.radius || 3.5, minWorldRadius);
        const radius = isHovered ? baseRadius * 1.35 : baseRadius;
        const labelY = node.y + radius + (3 / transform.scale);

        // Truncate overly long labels
        let displayLabel = node.label;
        if (displayLabel.length > 32 && !isHovered) {
          displayLabel = displayLabel.slice(0, 30) + '…';
        }

        if (isHovered || node.isCurrent) {
          // Render a prominent pill badge background for active/hovered node
          const textMetrics = ctx.measureText(displayLabel);
          const padX = 6 / transform.scale;
          const padY = 2 / transform.scale;
          const pillW = textMetrics.width + padX * 2;
          const pillH = fontWorldSize + padY * 2;
          const pillX = node.x - pillW / 2;
          const pillY = labelY;

          ctx.fillStyle = 'rgba(17, 17, 27, 0.9)';
          ctx.strokeStyle = isHovered ? '#89b4fa' : '#f9e2af';
          ctx.lineWidth = 1 / transform.scale;
          drawPill(ctx, pillX, pillY, pillW, pillH, 4 / transform.scale);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(displayLabel, node.x, labelY + padY);
        } else {
          // Crisp text with dark outline shadow
          ctx.strokeStyle = 'rgba(17, 17, 27, 0.85)';
          ctx.lineWidth = 2.5 / transform.scale;
          ctx.strokeText(displayLabel, node.x, labelY);

          ctx.fillStyle = isConnected ? '#ffffff' : 'rgba(205, 214, 244, 0.88)';
          ctx.fillText(displayLabel, node.x, labelY);
        }
      }

      ctx.restore();

      const shouldContinue = physicsActive || draggedNode || hoveredNode || isDraggingCanvas || needsRender;
      needsRender = false;

      if (shouldContinue) {
        physicsSettledFrames = 0;
        animationFrameId = requestAnimationFrame(renderLoop);
      } else {
        physicsSettledFrames++;
        if (physicsSettledFrames < SETTLE_THRESHOLD) {
          animationFrameId = requestAnimationFrame(renderLoop);
        }
      }
    }

    // Start initial render
    startRenderLoop();

    // --- Coordinate Transformation Helpers ---
    function screenToWorld(sx, sy) {
      return {
        x: (sx - transform.x) / transform.scale,
        y: (sy - transform.y) / transform.scale
      };
    }

    function findNodeAt(worldX, worldY) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const dx = worldX - node.x;
        const dy = worldY - node.y;
        const hitRadius = (node.radius + 6) / transform.scale;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          return node;
        }
      }
      return null;
    }

    // --- Interactive Mouse Handlers ---
    let mouseDownPos = null;
    let hasDragged = false;

    container.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      mouseDownPos = { x: e.clientX, y: e.clientY };
      hasDragged = false;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      const clicked = findNodeAt(world.x, world.y);

      if (clicked) {
        draggedNode = clicked;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        requestRender();
      } else {
        isDraggingCanvas = true;
        dragStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
      }
    });

    window.addEventListener('mousemove', e => {
      if (mouseDownPos && !hasDragged) {
        const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
        if (dist > 5) {
          hasDragged = true;
          if (hoveredNode) {
            hideTooltip();
          }
        }
      }

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (isDraggingCanvas) {
        transform.x = e.clientX - dragStart.x;
        transform.y = e.clientY - dragStart.y;
        requestRender();
        return;
      }

      const world = screenToWorld(sx, sy);

      if (draggedNode) {
        draggedNode.x = world.x;
        draggedNode.y = world.y;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        requestRender();
        return;
      }

      // Check Hover
      const hit = findNodeAt(world.x, world.y);
      if (hit !== hoveredNode) {
        hoveredNode = hit;
        requestRender();
        if (hoveredNode) {
          showTooltip(hoveredNode, e.clientX, e.clientY);
        } else {
          hideTooltip();
        }
      } else if (hoveredNode) {
        updateTooltipPosition(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      isDraggingCanvas = false;
      if (draggedNode) {
        draggedNode = null;
        requestRender();
      }
      mouseDownPos = null;
    });

    // Zoom on Wheel with wide scale limits (0.0005 to 20.0)
    container.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      const minScale = 0.0005;
      const maxScale = 20.0;
      const newScale = Math.max(minScale, Math.min(maxScale, transform.scale * zoomFactor));

      const scaleRatio = newScale / transform.scale;
      transform.x = mouseX - (mouseX - transform.x) * scaleRatio;
      transform.y = mouseY - (mouseY - transform.y) * scaleRatio;
      transform.scale = newScale;
      requestRender();
    }, { passive: false });

    // Click to open note (only if not dragging)
    container.addEventListener('click', e => {
      if (hasDragged) {
        hasDragged = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      const clicked = findNodeAt(world.x, world.y);

      if (clicked && clicked.filePath) {
        vscode.postMessage({
          command: 'openNote',
          filePath: clicked.filePath
        });
      }
    });

    // --- Tooltip Management ---
    function showTooltip(node, clientX, clientY) {
      ttTitle.textContent = node.label;
      ttPath.textContent = node.relativePath || node.filePath || '';

      let metaHtml = '';
      if (node.type === 'tag') {
        metaHtml += '<div>Type: <strong>Tag</strong></div>';
        metaHtml += '<div>Tagged Notes: <strong>' + (node.linkCount || 0) + '</strong></div>';
      } else if (node.type === 'attachment') {
        metaHtml += '<div>Type: <strong>Attachment</strong></div>';
        metaHtml += '<div>Referenced in: <strong>' + (node.linkCount || 0) + ' notes</strong></div>';
      } else {
        metaHtml += '<div>Links: <strong>' + (node.linkCount || 0) + '</strong> (' + (node.inDegree || 0) + ' in, ' + (node.outDegree || 0) + ' out)</div>';
        if (node.tags && node.tags.length > 0) {
          metaHtml += '<div>Tags: ' + node.tags.map(t => '<span class="tag-pill">#' + t + '</span>').join('') + '</div>';
        }
        if (node.categories && node.categories.length > 0) {
          metaHtml += '<div>Categories: ' + node.categories.join(', ') + '</div>';
        }
      }
      ttMeta.innerHTML = metaHtml;

      tooltip.style.display = 'block';
      updateTooltipPosition(clientX, clientY);
    }

    function updateTooltipPosition(clientX, clientY) {
      const pad = 12;
      let left = clientX + pad;
      let top = clientY + pad;

      if (left + 260 > window.innerWidth) {
        left = clientX - 270;
      }
      if (top + 140 > window.innerHeight) {
        top = clientY - 140;
      }

      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function hideTooltip() {
      tooltip.style.display = 'none';
    }

    // --- Filter & Graph Update Logic ---
    function applyFilters() {
      const oldNodeMap = new Map(nodeMap);
      nodeMap.clear();

      const exclSet = (configExcludedTags && configExcludedTags.length > 0)
        ? new Set(configExcludedTags.map(t => t.toLowerCase()))
        : null;
      const exclTag = selectedExcludeTag ? selectedExcludeTag.toLowerCase() : null;
      const inclTag = selectedTag ? selectedTag.toLowerCase() : null;

      // 1. Initial filter by type and tags
      const candidates = rawNodes.filter(n => {
        if (!showTags && n.type === 'tag') return false;
        if (!showAttachments && n.type === 'attachment') return false;

        const tagsLower = n.tagsLower || (n.tagsLower = (n.tags || []).map(t => t.toLowerCase()));

        if (exclSet && tagsLower.length > 0 && tagsLower.some(t => exclSet.has(t))) {
          return false;
        }
        if (exclTag && tagsLower.includes(exclTag)) {
          return false;
        }
        if (inclTag && !tagsLower.includes(inclTag)) {
          return false;
        }
        return true;
      });

      const candidateMap = new Map();
      for (let i = 0; i < candidates.length; i++) {
        candidateMap.set(candidates[i].id, candidates[i]);
      }

      // 2. Determine active links among candidates and compute active degrees
      const activeDegrees = new Map();
      const activeLinks = [];

      for (let i = 0; i < rawLinks.length; i++) {
        const l = rawLinks[i];
        if (!showTags && l.type === 'tag') continue;
        if (!showAttachments && l.type === 'attachment') continue;

        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;

        if (candidateMap.has(sId) && candidateMap.has(tId)) {
          activeLinks.push(l);
          activeDegrees.set(sId, (activeDegrees.get(sId) || 0) + 1);
          activeDegrees.set(tId, (activeDegrees.get(tId) || 0) + 1);
        }
      }

      // 3. Filter orphans based on active degree in current graph
      const finalNodes = showOrphans
        ? candidates
        : candidates.filter(n => (activeDegrees.get(n.id) || 0) > 0 || n.isCurrent);

      nodes = finalNodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.activeLinkCount = activeDegrees.get(n.id) || 0;
        const prev = oldNodeMap.get(n.id);
        if (prev && prev.x !== undefined && prev.y !== undefined) {
          n.x = prev.x;
          n.y = prev.y;
          n.vx = prev.vx || 0;
          n.vy = prev.vy || 0;
        }
        nodeMap.set(n.id, n);
      }

      links = activeLinks.filter(l => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        return nodeMap.has(sId) && nodeMap.has(tId);
      });

      statsBadge.textContent = nodes.length + ' notes • ' + links.length + ' links';
      initializeSimulation();
    }

    function fitView() {
      if (nodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;
      const graphW = Math.max(100, maxX - minX + 100);
      const graphH = Math.max(100, maxY - minY + 100);

      const scale = Math.min(1.5, Math.min(width / graphW, height / graphH) * 0.85);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      transform.scale = scale;
      transform.x = width / 2 - cx * scale;
      transform.y = height / 2 - cy * scale;
      requestRender();
    }

    // --- Event Listeners for Controls ---
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      parsedSearch = parseSearchQuery(searchQuery);
      saveState();
      requestRender();
    });

    tagFilter.addEventListener('change', e => {
      selectedTag = e.target.value;
      saveState();
      applyFilters();
    });

    tagExcludeFilter.addEventListener('change', e => {
      selectedExcludeTag = e.target.value;
      saveState();
      applyFilters();
    });

    labelModeSelect.addEventListener('change', e => {
      labelMode = e.target.value;
      saveState();
      requestRender();
    });

    toggleTags.addEventListener('change', e => {
      showTags = e.target.checked;
      saveState();
      applyFilters();
    });

    toggleAttachments.addEventListener('change', e => {
      showAttachments = e.target.checked;
      saveState();
      applyFilters();
    });

    toggleOrphans.addEventListener('change', e => {
      showOrphans = e.target.checked;
      saveState();
      applyFilters();
    });

    toggleLocal.addEventListener('change', e => {
      isLocalMode = e.target.checked;
      localDepthContainer.style.display = isLocalMode ? 'flex' : 'none';
      document.getElementById('panel-title-text').textContent = isLocalMode ? 'Local Graph' : 'Graph View';
      vscode.postMessage({
        command: 'setMode',
        isLocal: isLocalMode,
        depth: localDepth
      });
    });

    rangeDepth.addEventListener('input', e => {
      localDepth = parseInt(e.target.value, 10);
      depthVal.textContent = localDepth;
      vscode.postMessage({
        command: 'setMode',
        isLocal: isLocalMode,
        depth: localDepth
      });
    });

    // Forces Collapsible
    forcesHeader.addEventListener('click', () => {
      forcesContent.classList.toggle('collapsed');
      forcesArrow.innerHTML = forcesContent.classList.contains('collapsed')
        ? '<polyline points="6 9 12 15 18 9"/>'
        : '<polyline points="18 15 12 9 6 15"/>';
    });

    rangeCenterForce.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      centerForceMultiplier = val / 100;
      centerForceVal.textContent = val + '%';
      saveState();
      requestRender();
    });

    rangeRepelForce.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      repelForceMultiplier = val / 100;
      repelForceVal.textContent = val + '%';
      saveState();
      requestRender();
    });

    rangeLinkForce.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      linkForceMultiplier = val / 100;
      linkForceVal.textContent = val + '%';
      saveState();
      requestRender();
    });

    rangeLinkDist.addEventListener('input', e => {
      userLinkDistance = parseInt(e.target.value, 10);
      linkDistVal.textContent = userLinkDistance + 'px';
      saveState();
      requestRender();
    });

    btnResetView.addEventListener('click', fitView);

    btnTogglePhysics.addEventListener('click', () => {
      physicsRunning = !physicsRunning;
      btnTogglePhysics.textContent = physicsRunning ? 'Pause' : 'Resume';
      if (physicsRunning) {
        requestRender();
      }
    });

    btnResetFilters.addEventListener('click', resetFilters);

    btnTogglePanel.addEventListener('click', () => {
      controlsPanel.classList.toggle('collapsed');
      btnTogglePanel.innerHTML = controlsPanel.classList.contains('collapsed')
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>';
    });

    // --- Message Receiver from Extension Host ---
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'updateGraph') {
        const data = message.data || { nodes: [], links: [] };
        rawNodes = data.nodes || [];
        rawLinks = data.links || [];
        configExcludedTags = message.excludedTags || [];

        isLocalMode = !!message.isLocal;
        toggleLocal.checked = isLocalMode;
        localDepthContainer.style.display = isLocalMode ? 'flex' : 'none';
        document.getElementById('panel-title-text').textContent = isLocalMode ? 'Local Graph' : 'Graph View';

        if (message.localDepth) {
          localDepth = message.localDepth;
          rangeDepth.value = localDepth;
          depthVal.textContent = localDepth;
        }

        // Restore saved workspace settings on first load if not restored from webview state
        if (!hasRestoredInitialSettings && message.savedSettings) {
          restoreState(message.savedSettings);
          hasRestoredInitialSettings = true;
        }

        // Populate Tag Filter & Exclude Dropdowns (diff to avoid DOM thrash)
        const currentTag = tagFilter.value || selectedTag;
        const currentExcludeTag = tagExcludeFilter.value || selectedExcludeTag;
        const incomingTagsKey = message.allTags ? message.allTags.join('|') : '';

        if (incomingTagsKey !== lastRenderedTagsKey) {
          lastRenderedTagsKey = incomingTagsKey;
          tagFilter.innerHTML = '<option value="">Filter by Tag: All</option>';
          tagExcludeFilter.innerHTML = '<option value="">Exclude Tag: None</option>';

          if (message.allTags) {
            for (let i = 0; i < message.allTags.length; i++) {
              const tag = message.allTags[i];
              const opt1 = document.createElement('option');
              opt1.value = tag;
              opt1.textContent = '#' + tag;
              if (tag === currentTag) opt1.selected = true;
              tagFilter.appendChild(opt1);

              const opt2 = document.createElement('option');
              opt2.value = tag;
              opt2.textContent = '#' + tag;
              if (tag === currentExcludeTag) opt2.selected = true;
              tagExcludeFilter.appendChild(opt2);
            }
          }
        } else {
          tagFilter.value = currentTag;
          tagExcludeFilter.value = currentExcludeTag;
        }

        applyFilters();
        if (transform.scale === 1 && transform.x === 0 && transform.y === 0) {
          setTimeout(fitView, 100);
        }
      }
    });

    // Initial Request
    vscode.postMessage({ command: 'requestData' });
  </script>
</body>
</html>`;
  }
}

module.exports = {
  GraphViewManager
};
