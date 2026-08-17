const vscode = require('vscode');
const path = require('path');

/**
 * Growth stage definitions, icons, and aliases.
 */
const GROWTH_STAGES = {
  seedling: {
    key: 'seedling',
    label: 'Seedling',
    icon: '🌱',
    description: 'Raw thought, spark, or initial note',
    aliases: ['seedling', 'seed', 'sprout', 'raw', 'draft', '🌱']
  },
  budding: {
    key: 'budding',
    label: 'Budding',
    icon: '🌿',
    description: 'Developing note with growing structure and connections',
    aliases: ['budding', 'bud', 'growing', 'wip', 'in-progress', 'developing', '🌿']
  },
  evergreen: {
    key: 'evergreen',
    label: 'Evergreen',
    icon: '🌲',
    description: 'Mature, well-researched, and densely linked note',
    aliases: ['evergreen', 'tree', 'mature', 'complete', 'polished', 'done', '🌲']
  }
};

/**
 * Detects the growth stage of a note from its frontmatter and tags.
 * @param {object} noteData - { properties, tags, ... }
 * @param {object} [config]
 * @returns {{ key: string, label: string, icon: string, source: string }}
 */
function detectGrowthStage(noteData, config = {}) {
  const growthKey = (config.growthProperty || 'growth').toLowerCase();
  const properties = noteData && noteData.properties ? noteData.properties : new Map();
  const tags = noteData && noteData.tags ? Array.from(noteData.tags) : [];

  // Check designated frontmatter property first
  const keysToCheck = [growthKey, 'growth', 'stage', 'status', 'maturity'];
  for (const k of keysToCheck) {
    if (properties.has(k)) {
      const val = String(properties.get(k) || '').toLowerCase().trim();
      for (const [stageKey, meta] of Object.entries(GROWTH_STAGES)) {
        if (meta.aliases.some(alias => val === alias || val.includes(alias))) {
          return { key: stageKey, label: meta.label, icon: meta.icon, source: `frontmatter:${k}` };
        }
      }
    }
  }

  // Check tags for growth stage keywords
  for (const tag of tags) {
    const cleanTag = tag.toLowerCase().replace(/^#/, '');
    for (const [stageKey, meta] of Object.entries(GROWTH_STAGES)) {
      if (meta.aliases.some(alias => cleanTag === alias || cleanTag.endsWith(`/${alias}`))) {
        return { key: stageKey, label: meta.label, icon: meta.icon, source: `tag:#${tag}` };
      }
    }
  }

  return { key: 'unspecified', label: 'Unspecified', icon: '⚪', source: 'none' };
}

/**
 * Detects publish status of a note from its frontmatter and tags.
 * @param {object} noteData - { properties, tags, ... }
 * @param {object} [config]
 * @returns {{ isPublished: boolean, source: string }}
 */
function detectPublishStatus(noteData, config = {}) {
  const publishKey = (config.publishProperty || 'publish_external').toLowerCase();
  const properties = noteData && noteData.properties ? noteData.properties : new Map();
  const tags = noteData && noteData.tags ? Array.from(noteData.tags) : [];

  // 1. Check draft flag
  if (properties.has('draft')) {
    const draftVal = properties.get('draft');
    if (draftVal === true || String(draftVal).toLowerCase() === 'true') {
      return { isPublished: false, source: 'frontmatter:draft' };
    }
  }

  // 2. Check configured publish property
  const keysToCheck = [publishKey, 'publish_external', 'publish', 'published'];
  for (const k of keysToCheck) {
    if (properties.has(k)) {
      const val = properties.get(k);
      if (val === true || String(val).toLowerCase() === 'true' || val === 'yes' || val === '1') {
        return { isPublished: true, source: `frontmatter:${k}` };
      }
      if (val === false || String(val).toLowerCase() === 'false' || val === 'no' || val === '0') {
        return { isPublished: false, source: `frontmatter:${k}` };
      }
    }
  }

  // 3. Check tags
  for (const tag of tags) {
    const cleanTag = tag.toLowerCase().replace(/^#/, '');
    if (cleanTag === 'published' || cleanTag === 'publish' || cleanTag === 'public') {
      return { isPublished: true, source: `tag:#${tag}` };
    }
    if (cleanTag === 'private' || cleanTag === 'draft' || cleanTag === 'secret' || cleanTag === 'unlisted') {
      return { isPublished: false, source: `tag:#${tag}` };
    }
  }

  return { isPublished: false, source: 'default' };
}

/**
 * Updates or sets the growth property in markdown content frontmatter.
 * @param {string} content - Markdown document text
 * @param {string} newStage - 'seedling' | 'budding' | 'evergreen'
 * @param {string} [growthKey='growth']
 * @returns {string} Updated markdown text
 */
function setGrowthStageInMarkdown(content, newStage, growthKey = 'growth') {
  const hasFm = /^---\r?\n([\s\S]*?)\r?\n---/.test(content);
  const stageVal = newStage.toLowerCase();

  if (!hasFm) {
    return `---\n${growthKey}: ${stageVal}\n---\n\n${content}`;
  }

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const rawFm = fmMatch[1];
  const lines = rawFm.split(/\r?\n/);
  const regex = new RegExp(`^\\s*${growthKey}\\s*:.*$`, 'i');
  let found = false;

  const newLines = lines.map(line => {
    if (regex.test(line)) {
      found = true;
      return `${growthKey}: ${stageVal}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${growthKey}: ${stageVal}`);
  }

  const newFm = `---\n${newLines.join('\n')}\n---`;
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, newFm);
}

/**
 * Updates or sets the publish status property in markdown content frontmatter.
 * @param {string} content - Markdown document text
 * @param {boolean} isPublished - true or false
 * @param {string} [publishKey='publish_external']
 * @returns {string} Updated markdown text
 */
function setPublishStatusInMarkdown(content, isPublished, publishKey = 'publish_external') {
  const hasFm = /^---\r?\n([\s\S]*?)\r?\n---/.test(content);
  const pubVal = isPublished ? 'true' : 'false';

  if (!hasFm) {
    return `---\n${publishKey}: ${pubVal}\n---\n\n${content}`;
  }

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const rawFm = fmMatch[1];
  const lines = rawFm.split(/\r?\n/);
  const regex = new RegExp(`^\\s*${publishKey}\\s*:.*$`, 'i');
  let found = false;

  const newLines = lines.map(line => {
    if (regex.test(line)) {
      found = true;
      return `${publishKey}: ${pubVal}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${publishKey}: ${pubVal}`);
  }

  const newFm = `---\n${newLines.join('\n')}\n---`;
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, newFm);
}

function getIndexerNotesMap(indexer) {
  if (!indexer) return new Map();
  if (indexer.fileIndex) return indexer.fileIndex;
  if (indexer.notes) return indexer.notes;
  return new Map();
}

function getNoteMeta(indexer, filePath) {
  const map = getIndexerNotesMap(indexer);
  return map.get(filePath) || null;
}

function resolveNoteFromIndexer(indexer, target, sourceFilePath) {
  if (!indexer || !target) return null;
  if (indexer.resolveNotePath) {
    const targetPath = indexer.resolveNotePath(target, sourceFilePath);
    if (targetPath) {
      const meta = getNoteMeta(indexer, targetPath);
      if (meta) return meta;
    }
  }
  return null;
}

/**
 * Performs a full garden audit across the workspace indexer.
 * @param {object} indexer - WorkspaceNotesIndexer instance
 * @param {object} [config]
 * @returns {object} Audit report with growth, publishing, broken links, privacy leaks, orphans, dead ends
 */
function auditGarden(indexer, config = {}) {
  const allNotes = getIndexerNotesMap(indexer);
  const growthBreakdown = {
    seedling: [],
    budding: [],
    evergreen: [],
    unspecified: []
  };
  const publishBreakdown = {
    published: [],
    private: []
  };

  const brokenLinks = [];
  const privacyLeaks = [];
  const orphanNotes = [];
  const deadEnds = [];
  const ghostNotesMap = new Map(); // targetName -> [referencing notes]

  // Track incoming links count per file
  const incomingLinksCount = new Map();
  for (const filePath of allNotes.keys()) {
    incomingLinksCount.set(filePath, 0);
  }

  // Pre-calculate publish status map
  const notePublishMap = new Map();
  for (const [filePath, note] of allNotes.entries()) {
    const pubStatus = detectPublishStatus(note, config);
    notePublishMap.set(filePath, pubStatus.isPublished);

    if (pubStatus.isPublished) {
      publishBreakdown.published.push(note);
    } else {
      publishBreakdown.private.push(note);
    }

    const growth = detectGrowthStage(note, config);
    if (growthBreakdown[growth.key]) {
      growthBreakdown[growth.key].push(note);
    } else {
      growthBreakdown.unspecified.push(note);
    }
  }

  // Process links, broken links, privacy leaks, incoming counts
  for (const [filePath, note] of allNotes.entries()) {
    const isSourcePublished = notePublishMap.get(filePath) || false;
    const links = note.links || [];

    for (const link of links) {
      const linkTarget = link.targetNote || link.target || link.raw || '';
      // Find resolved target note in indexer
      const resolved = resolveNoteFromIndexer(indexer, linkTarget, filePath);

      if (!resolved) {
        // Target does not exist in workspace
        brokenLinks.push({
          sourceFile: filePath,
          sourceTitle: note.title || path.basename(filePath, '.md'),
          target: linkTarget,
          rawLink: link.raw,
          line: link.line !== undefined ? link.line : 0
        });

        const existingGhost = ghostNotesMap.get(linkTarget) || [];
        existingGhost.push({ sourceFile: filePath, sourceTitle: note.title || path.basename(filePath, '.md') });
        ghostNotesMap.set(linkTarget, existingGhost);
      } else {
        const targetPath = resolved.filePath;
        const currentCount = incomingLinksCount.get(targetPath) || 0;
        incomingLinksCount.set(targetPath, currentCount + 1);

        // Check privacy leak: published note linking to private note
        const isTargetPublished = notePublishMap.get(targetPath) || false;
        if (isSourcePublished && !isTargetPublished) {
          privacyLeaks.push({
            sourceFile: filePath,
            sourceTitle: note.title || path.basename(filePath, '.md'),
            target: linkTarget,
            targetFile: targetPath,
            targetTitle: resolved.title || path.basename(targetPath, '.md'),
            line: link.line !== undefined ? link.line : 0
          });
        }
      }
    }

    // Check dead ends (notes that have incoming links but 0 outgoing links)
    if (links.length === 0) {
      // Will check if it has incoming links later
    }
  }

  // Calculate orphan notes and dead ends
  for (const [filePath, note] of allNotes.entries()) {
    const incoming = incomingLinksCount.get(filePath) || 0;
    const outgoing = (note.links || []).length;

    if (incoming === 0 && outgoing === 0) {
      orphanNotes.push(note);
    } else if (incoming > 0 && outgoing === 0) {
      deadEnds.push(note);
    }
  }

  // Calculate overall garden health score (0 - 100)
  const total = allNotes.size;
  let healthScore = 100;
  if (total > 0) {
    const brokenPenalty = Math.min(40, (brokenLinks.length / total) * 50);
    const privacyPenalty = Math.min(30, (privacyLeaks.length / total) * 40);
    const orphanPenalty = Math.min(20, (orphanNotes.length / total) * 25);
    healthScore = Math.max(0, Math.round(100 - (brokenPenalty + privacyPenalty + orphanPenalty)));
  }

  const ghostNotes = Array.from(ghostNotesMap.entries()).map(([target, sources]) => ({
    target,
    referencingCount: sources.length,
    sources
  }));

  return {
    totalNotes: total,
    growth: growthBreakdown,
    publishing: publishBreakdown,
    brokenLinks,
    privacyLeaks,
    orphanNotes,
    deadEnds,
    ghostNotes,
    healthScore
  };
}

/**
 * Tree item representing categories or notes in the Digital Garden view.
 */
class DigitalGardenTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, contextValue, options = {}) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    this.options = options;

    if (options.description) {
      this.description = options.description;
    }
    if (options.tooltip) {
      this.tooltip = options.tooltip;
    }
    if (options.iconPath) {
      this.iconPath = options.iconPath;
    }
    if (options.command) {
      this.command = options.command;
    }
  }
}

/**
 * TreeDataProvider for the Digital Garden sidebar view.
 */
class DigitalGardenTreeDataProvider {
  constructor(indexer) {
    this.indexer = indexer;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.cachedAudit = null;

    if (this.indexer && this.indexer.onDidChangeIndex) {
      this.indexer.onDidChangeIndex(() => this.refresh());
    }
  }

  refresh() {
    this.cachedAudit = null;
    this._onDidChangeTreeData.fire();
  }

  getAudit() {
    if (!this.cachedAudit) {
      const config = vscode.workspace.getConfiguration('obsidian-notes');
      this.cachedAudit = auditGarden(this.indexer, {
        growthProperty: config.get('digitalGarden.growthProperty', 'growth'),
        publishProperty: config.get('digitalGarden.publishProperty', 'publish_external')
      });
    }
    return this.cachedAudit;
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    const audit = this.getAudit();

    if (!element) {
      // Root level categories
      const publishedPct = audit.totalNotes > 0
        ? Math.round((audit.publishing.published.length / audit.totalNotes) * 100)
        : 0;

      const overviewItem = new DigitalGardenTreeItem(
        `Garden Health: ${audit.healthScore}%`,
        vscode.TreeItemCollapsibleState.None,
        'garden-overview',
        {
          description: `${audit.totalNotes} notes (${publishedPct}% public)`,
          tooltip: `Garden Health Score: ${audit.healthScore}%\nTotal Notes: ${audit.totalNotes}\nPublished: ${audit.publishing.published.length}\nPrivate: ${audit.publishing.private.length}`,
          iconPath: new vscode.ThemeIcon(audit.healthScore > 80 ? 'check' : audit.healthScore > 50 ? 'warning' : 'error')
        }
      );

      const growthItem = new DigitalGardenTreeItem(
        'Growth Stages',
        vscode.TreeItemCollapsibleState.Expanded,
        'category-growth',
        {
          description: `🌱 ${audit.growth.seedling.length} | 🌿 ${audit.growth.budding.length} | 🌲 ${audit.growth.evergreen.length}`,
          iconPath: new vscode.ThemeIcon('symbol-event')
        }
      );

      const publishItem = new DigitalGardenTreeItem(
        'Publication Status',
        vscode.TreeItemCollapsibleState.Expanded,
        'category-publish',
        {
          description: `📢 ${audit.publishing.published.length} Public | 🔒 ${audit.publishing.private.length} Private`,
          iconPath: new vscode.ThemeIcon('globe')
        }
      );

      const doctorIssuesCount = audit.brokenLinks.length + audit.privacyLeaks.length + audit.orphanNotes.length;
      const doctorItem = new DigitalGardenTreeItem(
        'Garden Doctor',
        doctorIssuesCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        'category-doctor',
        {
          description: doctorIssuesCount === 0 ? 'All clean' : `${doctorIssuesCount} issues`,
          iconPath: new vscode.ThemeIcon('pulse')
        }
      );

      return [overviewItem, growthItem, publishItem, doctorItem];
    }

    // Children of Growth Stages category
    if (element.contextValue === 'category-growth') {
      return [
        new DigitalGardenTreeItem(`🌱 Seedlings (${audit.growth.seedling.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-growth-seedling', {
          notes: audit.growth.seedling
        }),
        new DigitalGardenTreeItem(`🌿 Budding (${audit.growth.budding.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-growth-budding', {
          notes: audit.growth.budding
        }),
        new DigitalGardenTreeItem(`🌲 Evergreen (${audit.growth.evergreen.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-growth-evergreen', {
          notes: audit.growth.evergreen
        }),
        new DigitalGardenTreeItem(`⚪ Unspecified (${audit.growth.unspecified.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-growth-unspecified', {
          notes: audit.growth.unspecified
        })
      ];
    }

    // Children of specific growth groups
    if (element.contextValue && element.contextValue.startsWith('group-growth-')) {
      const notes = (element.options && element.options.notes) || [];
      return notes.map(note => {
        const title = note.title || path.basename(note.filePath, '.md');
        return new DigitalGardenTreeItem(title, vscode.TreeItemCollapsibleState.None, 'note-item', {
          description: path.basename(path.dirname(note.filePath)),
          tooltip: note.filePath,
          iconPath: new vscode.ThemeIcon('markdown'),
          command: {
            command: 'vscode.open',
            title: 'Open Note',
            arguments: [vscode.Uri.file(note.filePath)]
          }
        });
      });
    }

    // Children of Publication Status category
    if (element.contextValue === 'category-publish') {
      return [
        new DigitalGardenTreeItem(`📢 Published Notes (${audit.publishing.published.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-publish-public', {
          notes: audit.publishing.published
        }),
        new DigitalGardenTreeItem(`🔒 Private Notes (${audit.publishing.private.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'group-publish-private', {
          notes: audit.publishing.private
        })
      ];
    }

    // Children of specific publish groups
    if (element.contextValue && element.contextValue.startsWith('group-publish-')) {
      const notes = (element.options && element.options.notes) || [];
      return notes.map(note => {
        const title = note.title || path.basename(note.filePath, '.md');
        return new DigitalGardenTreeItem(title, vscode.TreeItemCollapsibleState.None, 'note-item', {
          description: path.basename(path.dirname(note.filePath)),
          tooltip: note.filePath,
          iconPath: new vscode.ThemeIcon('markdown'),
          command: {
            command: 'vscode.open',
            title: 'Open Note',
            arguments: [vscode.Uri.file(note.filePath)]
          }
        });
      });
    }

    // Children of Garden Doctor category
    if (element.contextValue === 'category-doctor') {
      return [
        new DigitalGardenTreeItem(`⚠️ Broken Links (${audit.brokenLinks.length})`, audit.brokenLinks.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 'group-doctor-broken', {
          items: audit.brokenLinks
        }),
        new DigitalGardenTreeItem(`🛡️ Privacy Leaks (${audit.privacyLeaks.length})`, audit.privacyLeaks.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 'group-doctor-privacy', {
          items: audit.privacyLeaks
        }),
        new DigitalGardenTreeItem(`🏝️ Orphan Notes (${audit.orphanNotes.length})`, audit.orphanNotes.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 'group-doctor-orphans', {
          notes: audit.orphanNotes
        }),
        new DigitalGardenTreeItem(`🚪 Dead Ends (${audit.deadEnds.length})`, audit.deadEnds.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 'group-doctor-deadends', {
          notes: audit.deadEnds
        })
      ];
    }

    // Children of Broken Links
    if (element.contextValue === 'group-doctor-broken') {
      const items = (element.options && element.options.items) || [];
      return items.map(item => {
        const label = `[[${item.target}]] in ${item.sourceTitle}`;
        return new DigitalGardenTreeItem(label, vscode.TreeItemCollapsibleState.None, 'issue-broken-link', {
          description: `Line ${(item.line || 0) + 1}`,
          tooltip: `Target note "${item.target}" does not exist in workspace`,
          iconPath: new vscode.ThemeIcon('warning'),
          command: {
            command: 'vscode.open',
            title: 'Open Note at Line',
            arguments: [
              vscode.Uri.file(item.sourceFile),
              { selection: new vscode.Range(item.line || 0, 0, item.line || 0, 0) }
            ]
          }
        });
      });
    }

    // Children of Privacy Leaks
    if (element.contextValue === 'group-doctor-privacy') {
      const items = (element.options && element.options.items) || [];
      return items.map(item => {
        const label = `${item.sourceTitle} ➔ [[${item.targetTitle}]]`;
        return new DigitalGardenTreeItem(label, vscode.TreeItemCollapsibleState.None, 'issue-privacy-leak', {
          description: `Line ${(item.line || 0) + 1} (Target is Private)`,
          tooltip: `Public note "${item.sourceTitle}" links to private note "${item.targetTitle}"`,
          iconPath: new vscode.ThemeIcon('shield'),
          command: {
            command: 'vscode.open',
            title: 'Open Note at Line',
            arguments: [
              vscode.Uri.file(item.sourceFile),
              { selection: new vscode.Range(item.line || 0, 0, item.line || 0, 0) }
            ]
          }
        });
      });
    }

    // Children of Orphans or Dead Ends
    if (element.contextValue === 'group-doctor-orphans' || element.contextValue === 'group-doctor-deadends') {
      const notes = (element.options && element.options.notes) || [];
      return notes.map(note => {
        const title = note.title || path.basename(note.filePath, '.md');
        return new DigitalGardenTreeItem(title, vscode.TreeItemCollapsibleState.None, 'note-item', {
          description: path.basename(path.dirname(note.filePath)),
          tooltip: note.filePath,
          iconPath: new vscode.ThemeIcon('markdown'),
          command: {
            command: 'vscode.open',
            title: 'Open Note',
            arguments: [vscode.Uri.file(note.filePath)]
          }
        });
      });
    }

    return [];
  }

  dispose() {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Status Bar Manager for Digital Garden.
 * Displays interactive Stage and Publish buttons for the active editor.
 */
class DigitalGardenStatusBarManager {
  constructor(indexer) {
    this.indexer = indexer;
    this.growthStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
    this.publishStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);

    this.growthStatusBarItem.command = 'obsidian-notes.setGrowthStage';
    this.publishStatusBarItem.command = 'obsidian-notes.togglePublishStatus';

    this.update();
  }

  update() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown' || editor.document.uri.scheme !== 'file') {
      this.growthStatusBarItem.hide();
      this.publishStatusBarItem.hide();
      return;
    }

    const config = vscode.workspace.getConfiguration('obsidian-notes');
    const showStatusBar = config.get('digitalGarden.showStatusBar', true);
    if (!showStatusBar) {
      this.growthStatusBarItem.hide();
      this.publishStatusBarItem.hide();
      return;
    }

    const filePath = editor.document.fileName;
    const noteData = getNoteMeta(this.indexer, filePath);

    const growthConfig = {
      growthProperty: config.get('digitalGarden.growthProperty', 'growth'),
      publishProperty: config.get('digitalGarden.publishProperty', 'publish_external')
    };

    const growth = detectGrowthStage(noteData, growthConfig);
    const pubStatus = detectPublishStatus(noteData, growthConfig);

    // Growth Status Bar Item
    this.growthStatusBarItem.text = `${growth.icon} ${growth.label}`;
    this.growthStatusBarItem.tooltip = `Growth Stage: ${growth.label} (${growth.source})\nClick to change stage`;
    this.growthStatusBarItem.show();

    // Publish Status Bar Item
    if (pubStatus.isPublished) {
      this.publishStatusBarItem.text = `$(globe) Published`;
      this.publishStatusBarItem.tooltip = `Note is Public (${pubStatus.source})\nClick to set to Private`;
    } else {
      this.publishStatusBarItem.text = `$(lock) Private`;
      this.publishStatusBarItem.tooltip = `Note is Private (${pubStatus.source})\nClick to set to Published`;
    }
    this.publishStatusBarItem.show();
  }

  dispose() {
    this.growthStatusBarItem.dispose();
    this.publishStatusBarItem.dispose();
  }
}

/**
 * Diagnostics Provider for Digital Garden Health issues.
 * Surfaces warnings for broken wikilinks and public-to-private privacy leaks.
 */
class DigitalGardenDiagnosticsProvider {
  constructor(indexer) {
    this.indexer = indexer;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('obsidian-notes-garden');
    this.timeout = null;
  }

  updateDiagnostics(document) {
    if (!document || document.languageId !== 'markdown' || document.uri.scheme !== 'file') {
      return;
    }

    const config = vscode.workspace.getConfiguration('obsidian-notes');
    const enableDiagnostics = config.get('digitalGarden.enableDiagnostics', true);

    if (!enableDiagnostics) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const filePath = document.fileName;
    const note = getNoteMeta(this.indexer, filePath);
    if (!note) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const growthConfig = {
      growthProperty: config.get('digitalGarden.growthProperty', 'growth'),
      publishProperty: config.get('digitalGarden.publishProperty', 'publish_external')
    };

    const isSourcePublished = detectPublishStatus(note, growthConfig).isPublished;
    const links = note.links || [];
    const diagnostics = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (const link of links) {
      const lineNum = link.line !== undefined ? link.line : 0;
      const lineText = lines[lineNum] || '';
      const linkIdx = lineText.indexOf(link.raw);
      const startCol = linkIdx !== -1 ? linkIdx : 0;
      const endCol = startCol + (link.raw ? link.raw.length : link.target.length + 4);
      const range = new vscode.Range(lineNum, startCol, lineNum, endCol);

      const linkTarget = link.targetNote || link.target || link.raw || '';
      const resolved = resolveNoteFromIndexer(this.indexer, linkTarget, filePath);

      if (!resolved) {
        // Broken link
        const diag = new vscode.Diagnostic(
          range,
          `Obsidian Notes: Wikilink target "${linkTarget}" not found in workspace.`,
          vscode.DiagnosticSeverity.Warning
        );
        diag.source = 'Digital Garden Doctor';
        diag.code = 'broken-wikilink';
        diagnostics.push(diag);
      } else if (isSourcePublished) {
        // Check privacy leak
        const isTargetPublished = detectPublishStatus(resolved, growthConfig).isPublished;
        if (!isTargetPublished) {
          const targetTitle = resolved.title || path.basename(resolved.filePath, '.md');
          const diag = new vscode.Diagnostic(
            range,
            `Obsidian Notes: Privacy Leak — Public note links to private note "${targetTitle}".`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.source = 'Digital Garden Doctor';
          diag.code = 'privacy-leak';
          diagnostics.push(diag);
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  triggerUpdate(document, delay = 250) {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      this.updateDiagnostics(document);
    }, delay);
  }

  clear(uri) {
    if (uri) {
      this.diagnosticCollection.delete(uri);
    } else {
      this.diagnosticCollection.clear();
    }
  }

  dispose() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.diagnosticCollection.clear();
    this.diagnosticCollection.dispose();
  }
}

/**
 * Command: Toggle Publish Status of Active Note
 */
async function togglePublishStatusCommand(indexer, statusBarManager, treeDataProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('Obsidian Notes: Open a markdown note to toggle its publish status.');
    return;
  }

  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const publishProperty = config.get('digitalGarden.publishProperty', 'publish_external');
  const filePath = editor.document.fileName;
  const noteData = getNoteMeta(indexer, filePath);
  const currentStatus = detectPublishStatus(noteData, { publishProperty });
  const newStatus = !currentStatus.isPublished;

  const content = editor.document.getText();
  const updatedContent = setPublishStatusInMarkdown(content, newStatus, publishProperty);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(content.length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, fullRange, updatedContent);
  await vscode.workspace.applyEdit(edit);
  await editor.document.save();

  indexer.indexFile(filePath);
  if (statusBarManager) statusBarManager.update();
  if (treeDataProvider) treeDataProvider.refresh();

  vscode.window.showInformationMessage(
    `Obsidian Notes: Note set to ${newStatus ? '📢 Published' : '🔒 Private'} (${publishProperty}: ${newStatus}).`
  );
}

/**
 * Command: Set Growth Stage of Active Note
 */
async function setGrowthStageCommand(indexer, statusBarManager, treeDataProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('Obsidian Notes: Open a markdown note to change its growth stage.');
    return;
  }

  const items = [
    { label: '🌱 Seedling', description: 'Raw spark, thought, or initial draft', stageKey: 'seedling' },
    { label: '🌿 Budding', description: 'Developing note with growing links and structure', stageKey: 'budding' },
    { label: '🌲 Evergreen', description: 'Mature, polished, high-value knowledge asset', stageKey: 'evergreen' }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Note Growth Stage'
  });

  if (!selected) return;

  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const growthProperty = config.get('digitalGarden.growthProperty', 'growth');
  const filePath = editor.document.fileName;

  const content = editor.document.getText();
  const updatedContent = setGrowthStageInMarkdown(content, selected.stageKey, growthProperty);

  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(content.length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, fullRange, updatedContent);
  await vscode.workspace.applyEdit(edit);
  await editor.document.save();

  indexer.indexFile(filePath);
  if (statusBarManager) statusBarManager.update();
  if (treeDataProvider) treeDataProvider.refresh();

  vscode.window.showInformationMessage(`Obsidian Notes: Growth stage set to ${selected.label}.`);
}

/**
 * Command: Run Garden Audit and Display Summary
 */
async function runGardenAuditCommand(indexer) {
  const config = vscode.workspace.getConfiguration('obsidian-notes');
  const audit = auditGarden(indexer, {
    growthProperty: config.get('digitalGarden.growthProperty', 'growth'),
    publishProperty: config.get('digitalGarden.publishProperty', 'publish_external')
  });

  const msg = `Garden Audit Complete:\nHealth Score: ${audit.healthScore}%\nTotal Notes: ${audit.totalNotes} (${audit.publishing.published.length} Public / ${audit.publishing.private.length} Private)\nBroken Links: ${audit.brokenLinks.length} | Privacy Leaks: ${audit.privacyLeaks.length} | Orphans: ${audit.orphanNotes.length}`;
  vscode.window.showInformationMessage(msg);
}

module.exports = {
  GROWTH_STAGES,
  detectGrowthStage,
  detectPublishStatus,
  setGrowthStageInMarkdown,
  setPublishStatusInMarkdown,
  auditGarden,
  DigitalGardenTreeDataProvider,
  DigitalGardenStatusBarManager,
  DigitalGardenDiagnosticsProvider,
  togglePublishStatusCommand,
  setGrowthStageCommand,
  runGardenAuditCommand
};
