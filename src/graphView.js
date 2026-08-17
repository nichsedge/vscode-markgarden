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

    this.panel.webview.postMessage({
      command: 'updateGraph',
      data,
      isLocal: this.isLocal,
      localDepth: this.localDepth,
      activeNoteTitle: this.activeFilePath ? path.basename(this.activeFilePath, '.md') : '',
      allTags: this._cachedTagList,
      allCategories: this._cachedCategoryList
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
      width: 280px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
      z-index: 10;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .controls-panel.collapsed {
      width: auto;
      padding: 8px 12px;
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
        <input type="text" id="search-input" placeholder="Search notes..." />
      </div>

      <div class="input-group">
        <select id="tag-filter">
          <option value="">Filter by Tag: All</option>
        </select>
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

      <div class="toggle-row">
        <span>Show Orphans</span>
        <label class="switch">
          <input type="checkbox" id="toggle-orphans" checked>
          <span class="slider"></span>
        </label>
      </div>

      <div class="btn-row">
        <button class="btn-action" id="btn-reset-view">Fit View</button>
        <button class="btn-action" id="btn-toggle-physics">Pause</button>
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
    const toggleLocal = document.getElementById('toggle-local');
    const localDepthContainer = document.getElementById('local-depth-container');
    const rangeDepth = document.getElementById('range-depth');
    const depthVal = document.getElementById('depth-val');
    const toggleOrphans = document.getElementById('toggle-orphans');
    const btnResetView = document.getElementById('btn-reset-view');
    const btnTogglePhysics = document.getElementById('btn-toggle-physics');
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
    let showOrphans = true;
    let searchQuery = '';
    let selectedTag = '';
    let physicsRunning = true;

    // View Transformation (Pan & Zoom)
    let transform = { x: 0, y: 0, scale: 1 };
    let isDraggingCanvas = false;
    let dragStart = { x: 0, y: 0 };
    let hoveredNode = null;
    let draggedNode = null;

    // Render loop control — stops when tab is hidden or idle
    let animationFrameId = null;
    let isPageVisible = true;
    let needsRender = true;
    let physicsSettledFrames = 0;
    const SETTLE_THRESHOLD = 120; // ~2s of sub-threshold movement = settle

    // Reusable Set for highlight detection — avoids allocation every frame
    const highlightedNodeIds = new Set();

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

    // Pause render loop when page is hidden (panel not visible)
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

      // Assign initial positions proportionally around center if not already set
      const spreadRadius = Math.max(width, height) * 0.35 * Math.sqrt(Math.max(1, nodes.length / 50));
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.x === undefined || node.y === undefined) {
          const angle = (i / Math.max(1, nodes.length)) * 2 * Math.PI;
          const r = spreadRadius * (0.3 + Math.random() * 0.7);
          node.x = width / 2 + r * Math.cos(angle);
          node.y = height / 2 + r * Math.sin(angle);
          node.vx = (Math.random() - 0.5) * 2;
          node.vy = (Math.random() - 0.5) * 2;
        }
        node.radius = Math.max(4, Math.min(14, 4 + Math.sqrt(node.linkCount || 1) * 2.5));
      }
      requestRender();
    }

    function stepPhysics() {
      if (!physicsRunning && !draggedNode) return false;

      const width = container.clientWidth;
      const height = container.clientHeight;
      const cx = width / 2;
      const cy = height / 2;

      // Dynamically scale repulsion force based on node count so 2000+ nodes don't explode physics
      const baseRepulsion = nodes.length > 200
        ? Math.max(100, 1200 / Math.sqrt(nodes.length / 50))
        : 1200;

      const linkDistance = nodes.length > 500 ? 50 : 75;
      const linkStrength = 0.04;
      const centerGravity = 0.008;
      const damping = 0.88;

      // 1. Center gravity force
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node === draggedNode) continue;
        node.vx += (cx - node.x) * centerGravity;
        node.vy += (cy - node.y) * centerGravity;
      }

      // 2. Coulomb Repulsion between nodes (distance-capped for large graphs)
      const maxDistanceSq = nodes.length > 500 ? 250000 : 900000;
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy + 100;
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

      // 4. Integrate velocity & damping, cap max speed to prevent physics explosions
      const maxVel = 12;
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

      // Return true if physics are still active (not settled)
      return totalEnergy > 0.01;
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

      // Build highlighted neighbor set if hovered — reuses existing Set
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

      // Render Links with minimum line width in screen space so they stay visible when zoomed out
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
          ctx.lineWidth = Math.max(minLineWidth * 2, 2 / transform.scale);
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(180, 190, 254, 0.06)';
          ctx.lineWidth = Math.max(minLineWidth * 0.8, 0.8 / transform.scale);
        } else {
          ctx.strokeStyle = 'rgba(180, 190, 254, 0.25)';
          ctx.lineWidth = Math.max(minLineWidth, 1 / transform.scale);
        }

        ctx.stroke();
      }

      // Cache lowered search query outside the node loop
      const lowerSearch = searchQuery ? searchQuery.toLowerCase() : '';

      // Render Nodes with minimum radius in screen space (2.5px) so nodes NEVER disappear when zoomed out
      const minScreenRadius = 2.5;
      const minWorldRadius = minScreenRadius / transform.scale;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isHovered = node === hoveredNode;
        const isConnected = highlightedNodeIds.has(node.id);
        const matchesSearch = lowerSearch ? node.label.toLowerCase().includes(lowerSearch) : true;
        const isDimmed = (hoveredNode && !isConnected) || (!matchesSearch);

        const nodeColor = node.isCurrent ? '#f9e2af' : getTagColor(node.tags);
        const baseRadius = Math.max(node.radius || 4, minWorldRadius);
        const radius = isHovered ? baseRadius * 1.3 : baseRadius;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);

        if (isDimmed) {
          ctx.fillStyle = 'rgba(108, 112, 134, 0.2)';
        } else {
          ctx.fillStyle = nodeColor;
        }
        ctx.fill();

        // Node outline/glow
        if (isHovered || node.isCurrent) {
          ctx.lineWidth = Math.max(1 / transform.scale, (isHovered ? 3 : 2) / transform.scale);
          ctx.strokeStyle = isHovered ? '#ffffff' : '#f9e2af';
          ctx.stroke();
        }

        // Node Label
        const shouldShowLabel = transform.scale > 0.6 || isHovered || isConnected || node.isCurrent || (searchQuery && matchesSearch);
        if (shouldShowLabel && !isDimmed) {
          ctx.font = Math.max(10, Math.round(12 / Math.sqrt(transform.scale))) + 'px sans-serif';
          ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.label, node.x, node.y + radius + 4);
        }
      }

      ctx.restore();

      // Decide whether to continue the render loop
      const shouldContinue = physicsActive || draggedNode || hoveredNode || isDraggingCanvas || needsRender;
      needsRender = false;

      if (shouldContinue) {
        physicsSettledFrames = 0;
        animationFrameId = requestAnimationFrame(renderLoop);
      } else {
        physicsSettledFrames++;
        if (physicsSettledFrames < SETTLE_THRESHOLD) {
          // Keep running briefly to detect full settling
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
    container.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
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
    });

    // Zoom on Wheel with wide scale limits (0.0005 to 20.0) so large graphs don't snap or lose nodes
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

    // Click to open note
    container.addEventListener('click', e => {
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
      ttPath.textContent = node.relativePath || '';

      let metaHtml = '<div>Links: <strong>' + (node.linkCount || 0) + '</strong> (' + (node.inDegree || 0) + ' in, ' + (node.outDegree || 0) + ' out)</div>';
      if (node.tags && node.tags.length > 0) {
        metaHtml += '<div>Tags: ' + node.tags.map(t => '<span class="tag-pill">#' + t + '</span>').join('') + '</div>';
      }
      if (node.categories && node.categories.length > 0) {
        metaHtml += '<div>Categories: ' + node.categories.join(', ') + '</div>';
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
      let filtered = rawNodes;

      if (!showOrphans) {
        filtered = filtered.filter(n => (n.linkCount || 0) > 0 || n.isCurrent);
      }

      if (selectedTag) {
        filtered = filtered.filter(n => n.tags && n.tags.includes(selectedTag));
      }

      nodes = filtered;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const prev = oldNodeMap.get(n.id);
        if (prev && prev.x !== undefined && prev.y !== undefined) {
          n.x = prev.x;
          n.y = prev.y;
          n.vx = prev.vx || 0;
          n.vy = prev.vy || 0;
        }
        nodeMap.set(n.id, n);
      }

      links = rawLinks.filter(l => {
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
      requestRender();
    });

    tagFilter.addEventListener('change', e => {
      selectedTag = e.target.value;
      applyFilters();
    });

    toggleOrphans.addEventListener('change', e => {
      showOrphans = e.target.checked;
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

    btnResetView.addEventListener('click', fitView);

    btnTogglePhysics.addEventListener('click', () => {
      physicsRunning = !physicsRunning;
      btnTogglePhysics.textContent = physicsRunning ? 'Pause' : 'Resume';
      if (physicsRunning) {
        requestRender();
      }
    });

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

        isLocalMode = !!message.isLocal;
        toggleLocal.checked = isLocalMode;
        localDepthContainer.style.display = isLocalMode ? 'flex' : 'none';
        document.getElementById('panel-title-text').textContent = isLocalMode ? 'Local Graph' : 'Graph View';

        if (message.localDepth) {
          localDepth = message.localDepth;
          rangeDepth.value = localDepth;
          depthVal.textContent = localDepth;
        }

        // Populate Tag Filter Dropdown
        const currentTag = tagFilter.value;
        tagFilter.innerHTML = '<option value="">Filter by Tag: All</option>';
        if (message.allTags) {
          for (let i = 0; i < message.allTags.length; i++) {
            const tag = message.allTags[i];
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = '#' + tag;
            if (tag === currentTag) opt.selected = true;
            tagFilter.appendChild(opt);
          }
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
