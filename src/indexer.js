const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Parses frontmatter YAML block from markdown content.
 * Returns an object with parsed properties (title, tags, categories, raw content).
 */
function parseFrontmatter(content) {
  const result = {
    title: '',
    tags: new Set(),
    categories: new Set(),
    hasFrontmatter: false,
    frontmatterRange: null
  };

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return result;
  }

  result.hasFrontmatter = true;
  const rawYaml = match[1];
  const lines = rawYaml.split('\n');
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check for list item under current key (e.g. "  - tag1")
    if (trimmed.startsWith('-') && currentKey) {
      const itemVal = trimmed.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      if (itemVal) {
        if (currentKey === 'tags' || currentKey === 'tag') {
          result.tags.add(itemVal);
        } else if (currentKey === 'categories' || currentKey === 'category') {
          result.categories.add(itemVal);
        }
      }
      continue;
    }

    const colonIdx = rawLine.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }

    const key = rawLine.slice(0, colonIdx).trim().toLowerCase();
    const val = rawLine.slice(colonIdx + 1).trim();

    if (key === 'title') {
      currentKey = 'title';
      result.title = val.replace(/^['"]|['"]$/g, '');
    } else if (key === 'tags' || key === 'tag') {
      currentKey = 'tags';
      if (val) {
        // May be bracketed "[tag1, tag2]" or comma-separated "tag1, tag2"
        const cleaned = val.replace(/[[\]]/g, '');
        cleaned.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(t => result.tags.add(t));
      }
    } else if (key === 'categories' || key === 'category') {
      currentKey = 'categories';
      if (val) {
        const cleaned = val.replace(/[[\]]/g, '');
        cleaned.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(c => result.categories.add(c));
      }
    } else {
      currentKey = key;
    }
  }

  return result;
}

/**
 * Strips code blocks, inline code, HTML comments, frontmatter, and URLs from markdown text
 * so hashtag parsing doesn't match false positives.
 * Uses combined regex passes for performance.
 */
function sanitizeContentForTags(content) {
  // Single combined pass: strip frontmatter, fenced code blocks (``` and ~~~), and HTML comments
  let sanitized = content.replace(/^---\r?\n[\s\S]*?\r?\n---|```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, '');
  // Remove inline code `...` and URLs
  sanitized = sanitized.replace(/`[^`\r\n]+`|https?:\/\/[^\s)]+/g, '');
  // Remove markdown headers: lines starting with #, ##, etc.
  sanitized = sanitized.replace(/^[ \t]*#{1,6}[ \t]+.*$/gm, '');

  return sanitized;
}

/**
 * Extracts inline #tags (e.g. #productivity, #project/web) from markdown text.
 */
function extractInlineTags(content) {
  const tags = new Set();
  const sanitized = sanitizeContentForTags(content);

  // Match #tag where tag starts with a letter, underscore, or non-ASCII, followed by letters/digits/underscores/dashes/slashes
  // Cannot be purely numeric
  const tagRegex = /(?:^|\s)#([a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*(?:\/[a-zA-Z0-9_\-\u0080-\uFFFF]+)*)/g;
  let match;
  while ((match = tagRegex.exec(sanitized)) !== null) {
    const tag = match[1];
    // Exclude if followed immediately by punctuation like #tag.
    const cleanTag = tag.replace(/[.,:;!?]+$/, '');
    if (cleanTag) {
      tags.add(cleanTag);
    }
  }

  return tags;
}

/**
 * Extracts all markdown headings with their text and 0-indexed line numbers.
 */
function extractHeadings(content) {
  const headings = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^[ \t]*(#{1,6})[ \t]+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i
      });
    }
  }
  return headings;
}

/**
 * Parses wikilink string (e.g. "Note Name#Section|Alias") into components.
 */
function parseWikilinkTarget(rawLink) {
  let text = rawLink.trim();
  let alias = '';
  let heading = '';
  let targetNote = '';

  // Check for alias: [[target|alias]] or [[target\|alias]]
  const pipeIdx = text.indexOf('|');
  if (pipeIdx !== -1) {
    alias = text.slice(pipeIdx + 1).trim();
    text = text.slice(0, pipeIdx).trim();
  }

  // Check for heading anchor: [[target#heading]] or [[#heading]]
  const hashIdx = text.indexOf('#');
  if (hashIdx !== -1) {
    heading = text.slice(hashIdx + 1).trim();
    targetNote = text.slice(0, hashIdx).trim();
  } else {
    targetNote = text.trim();
  }

  return {
    raw: rawLink,
    targetNote,
    heading,
    alias
  };
}

/**
 * Extracts all outbound wikilinks from markdown content.
 */
function extractWikilinks(content) {
  const sanitized = sanitizeContentForTags(content);
  const links = [];
  const regex = /\[\[([^[\r\n\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(sanitized)) !== null) {
    const parsed = parseWikilinkTarget(match[1]);
    links.push(parsed);
  }
  return links;
}

/**
 * Central Markdown Indexer for workspace notes.
 */
class WorkspaceNotesIndexer {
  constructor() {
    this.fileIndex = new Map(); // filePath -> { title, relativePath, headings, tags, categories, links, resolvedLinks }
    this.tagIndex = new Map(); // tag -> Set<filePath>
    this.categoryIndex = new Map(); // category -> Set<filePath>
    this.titleToPathIndex = new Map(); // lowercase note name (without .md) -> Set<filePath>
    
    this._onDidChangeIndex = new vscode.EventEmitter();
    this.onDidChangeIndex = this._onDidChangeIndex.event;
    
    this.isIndexing = false;
    this._watcher = null;
    this._debounceTimers = new Map(); // filePath -> timerId (per-file debouncing)
    this._disposables = [];

    // Cached sorted results with dirty flag
    this._cachedTags = null;
    this._cachedCategories = null;
    this._indexDirty = true;
  }

  /**
   * Initializes indexer, builds initial index, and sets up file system watchers.
   */
  async initialize(context) {
    await this.rebuildIndex();

    // Create file system watcher for markdown files
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.md');

    const createDisposable = this._watcher.onDidCreate(uri => this._handleFileChange(uri.fsPath));
    const changeDisposable = this._watcher.onDidChange(uri => this._handleFileChange(uri.fsPath));
    const deleteDisposable = this._watcher.onDidDelete(uri => this._handleFileDelete(uri.fsPath));

    this._disposables.push(createDisposable, changeDisposable, deleteDisposable);

    // Watch for configuration changes that might affect exclusions or folders
    const configDisposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('obsidian-notes')) {
        this.rebuildIndex();
      }
    });

    this._disposables.push(configDisposable);

    context.subscriptions.push(this._watcher);
    context.subscriptions.push(this._onDidChangeIndex);
    context.subscriptions.push(...this._disposables);
  }

  /**
   * Full scan of workspace for markdown files.
   */
  async rebuildIndex() {
    this.isIndexing = true;
    this.fileIndex.clear();
    this.tagIndex.clear();
    this.categoryIndex.clear();
    this.titleToPathIndex.clear();
    this._invalidateCache();

    const config = vscode.workspace.getConfiguration('obsidian-notes');
    const excluded = config.get('excludedFolders', [
      '**/node_modules/**',
      '**/.git/**',
      '**/.vscode/**',
      '**/dist/**',
      '**/out/**',
      '**/vendor/**'
    ]);

    const excludePattern = excluded.length > 0 ? `{${excluded.join(',')}}` : undefined;
    const files = await vscode.workspace.findFiles('**/*.md', excludePattern);

    // Read files concurrently in batches for performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(fileUri => fs.promises.readFile(fileUri.fsPath, 'utf8').then(content => ({ fsPath: fileUri.fsPath, content })))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          this._indexFileContent(result.value.fsPath, result.value.content);
        }
      }
    }

    // Second pass: resolve link targets now that all files are indexed
    this._resolveAllLinkTargets();

    this.isIndexing = false;
    this._onDidChangeIndex.fire();
  }

  /**
   * Handles real-time file update with per-file debounce.
   * Each file gets its own debounce timer so rapid edits to file A
   * don't cancel a pending re-index of file B.
   */
  _handleFileChange(filePath) {
    if (!filePath.endsWith('.md')) return;
    if (this._shouldIgnore(filePath)) return;

    // Clear only this file's timer
    const existingTimer = this._debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timerId = setTimeout(async () => {
      this._debounceTimers.delete(filePath);
      try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        this._removeFileFromIndices(filePath);
        this._indexFileContent(filePath, content);
        this._resolveLinksForFile(filePath);
        this._invalidateCache();
        this._onDidChangeIndex.fire();
      } catch {
        // Handle race conditions where file was removed before read
      }
    }, 150);

    this._debounceTimers.set(filePath, timerId);
  }

  // Keep public alias for backwards compatibility with navigateWikilink calling handleFileChange
  handleFileChange(filePath) {
    this._handleFileChange(filePath);
  }

  /**
   * Handles real-time file deletion.
   */
  _handleFileDelete(filePath) {
    this._removeFileFromIndices(filePath);
    this.fileIndex.delete(filePath);
    this._invalidateCache();
    this._onDidChangeIndex.fire();
  }

  /**
   * Invalidates cached sorted tag/category lists.
   */
  _invalidateCache() {
    this._cachedTags = null;
    this._cachedCategories = null;
    this._indexDirty = true;
  }

  /**
   * Check if a path matches common exclusion directories.
   */
  _shouldIgnore(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.includes('/node_modules/') ||
           normalized.includes('/.git/') ||
           normalized.includes('/.vscode/') ||
           normalized.includes('/dist/') ||
           normalized.includes('/out/');
  }

  /**
   * Indexes a single markdown file's contents.
   * Does not resolve link targets — call _resolveLinksForFile or _resolveAllLinkTargets after.
   */
  _indexFileContent(filePath, content) {
    const baseName = path.basename(filePath, '.md');
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    const relativePath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, filePath) : baseName;

    const frontmatter = parseFrontmatter(content);
    const inlineTags = extractInlineTags(content);
    const headings = extractHeadings(content);

    // Merge tags
    const allTags = new Set([...frontmatter.tags, ...inlineTags]);
    const primaryHeading = headings.length > 0 && headings[0].level === 1 ? headings[0].text : '';
    const title = frontmatter.title || primaryHeading || baseName;

    const wikilinks = extractWikilinks(content);

    // Record file entry — store only what's needed, not the full frontmatter object
    const meta = {
      filePath,
      relativePath,
      baseName,
      title,
      frontmatterTitle: frontmatter.title || '',
      headings,
      tags: allTags,
      categories: frontmatter.categories,
      links: wikilinks,
      resolvedLinks: [] // populated by _resolveLinksForFile
    };
    this.fileIndex.set(filePath, meta);

    // Inverted index for tags
    for (const tag of allTags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag).add(filePath);
    }

    // Inverted index for categories
    for (const cat of frontmatter.categories) {
      if (!this.categoryIndex.has(cat)) {
        this.categoryIndex.set(cat, new Set());
      }
      this.categoryIndex.get(cat).add(filePath);
    }

    // Inverted index for note titles and basenames (case-insensitive)
    const baseKey = baseName.toLowerCase();
    if (!this.titleToPathIndex.has(baseKey)) {
      this.titleToPathIndex.set(baseKey, new Set());
    }
    this.titleToPathIndex.get(baseKey).add(filePath);

    if (frontmatter.title) {
      const titleKey = frontmatter.title.toLowerCase();
      if (!this.titleToPathIndex.has(titleKey)) {
        this.titleToPathIndex.set(titleKey, new Set());
      }
      this.titleToPathIndex.get(titleKey).add(filePath);
    } else if (headings.length > 0 && headings[0].level === 1) {
      const h1Key = headings[0].text.toLowerCase();
      if (!this.titleToPathIndex.has(h1Key)) {
        this.titleToPathIndex.set(h1Key, new Set());
      }
      this.titleToPathIndex.get(h1Key).add(filePath);
    }
  }

  // Public alias for testing
  indexFileContent(filePath, content) {
    this._indexFileContent(filePath, content);
    this._resolveLinksForFile(filePath);
  }

  /**
   * Resolves link targets for a single file using the current index state.
   */
  _resolveLinksForFile(filePath) {
    const meta = this.fileIndex.get(filePath);
    if (!meta) return;

    meta.resolvedLinks = [];
    for (const link of meta.links) {
      if (!link.targetNote) continue;
      const targetPath = this.resolveNotePath(link.targetNote, filePath);
      if (targetPath) {
        meta.resolvedLinks.push({ link, targetPath });
      }
    }
  }

  /**
   * Resolves all link targets after a full index rebuild.
   */
  _resolveAllLinkTargets() {
    for (const filePath of this.fileIndex.keys()) {
      this._resolveLinksForFile(filePath);
    }
  }

  /**
   * Removes a file from inverted indices before re-indexing or after deletion.
   */
  _removeFileFromIndices(filePath) {
    const existing = this.fileIndex.get(filePath);
    if (!existing) return;

    for (const tag of existing.tags) {
      const set = this.tagIndex.get(tag);
      if (set) {
        set.delete(filePath);
        if (set.size === 0) this.tagIndex.delete(tag);
      }
    }

    for (const cat of existing.categories) {
      const set = this.categoryIndex.get(cat);
      if (set) {
        set.delete(filePath);
        if (set.size === 0) this.categoryIndex.delete(cat);
      }
    }

    const baseKey = existing.baseName.toLowerCase();
    const baseSet = this.titleToPathIndex.get(baseKey);
    if (baseSet) {
      baseSet.delete(filePath);
      if (baseSet.size === 0) this.titleToPathIndex.delete(baseKey);
    }

    if (existing.frontmatterTitle) {
      const titleKey = existing.frontmatterTitle.toLowerCase();
      const titleSet = this.titleToPathIndex.get(titleKey);
      if (titleSet) {
        titleSet.delete(filePath);
        if (titleSet.size === 0) this.titleToPathIndex.delete(titleKey);
      }
    }
  }

  /**
   * Resolves a target note name to an absolute file path.
   * Index-first strategy: prefers Map lookups over filesystem I/O.
   */
  resolveNotePath(targetNote, sourceFilePath) {
    if (!targetNote) return null;
    let clean = targetNote.trim();
    if (clean.endsWith('.md')) {
      clean = clean.slice(0, -3);
    }

    const key = clean.toLowerCase();

    // 1. Fast path: exact match in title index (O(1) Map lookup)
    const exactMatches = this.titleToPathIndex.get(key);
    if (exactMatches && exactMatches.size > 0) {
      // Prefer a match in the same directory as source file
      if (sourceFilePath) {
        const sourceDir = path.dirname(sourceFilePath);
        for (const candidate of exactMatches) {
          if (path.dirname(candidate) === sourceDir) {
            return candidate;
          }
        }
      }
      return exactMatches.values().next().value;
    }

    // 2. Normalized match ignoring spaces, dashes, and underscores
    const normalizedTarget = key.replace(/[\s\-_]/g, '');
    for (const [indexedKey, paths] of this.titleToPathIndex.entries()) {
      if (indexedKey.replace(/[\s\-_]/g, '') === normalizedTarget && paths.size > 0) {
        return paths.values().next().value;
      }
    }

    // 3. Fallback: filesystem check for notes not yet in the index
    if (sourceFilePath) {
      const sourceDir = path.dirname(sourceFilePath);
      const relativeCandidate = path.join(sourceDir, `${clean}.md`);
      try {
        fs.accessSync(relativeCandidate);
        return relativeCandidate;
      } catch {
        // Not found at relative path
      }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const wf of workspaceFolders) {
        const candidate = path.join(wf.uri.fsPath, `${clean}.md`);
        try {
          fs.accessSync(candidate);
          return candidate;
        } catch {
          // Not found at workspace path
        }
      }
    }

    return null;
  }

  /**
   * Get all indexed tags and their note counts.
   * Returns cached sorted results when the index hasn't changed.
   */
  getAllTags() {
    if (this._cachedTags) return this._cachedTags;

    this._cachedTags = Array.from(this.tagIndex.entries()).map(([tag, files]) => ({
      tag,
      count: files.size,
      files: Array.from(files)
    })).sort((a, b) => a.tag.localeCompare(b.tag));

    return this._cachedTags;
  }

  /**
   * Get all indexed categories and their note counts.
   * Returns cached sorted results when the index hasn't changed.
   */
  getAllCategories() {
    if (this._cachedCategories) return this._cachedCategories;

    this._cachedCategories = Array.from(this.categoryIndex.entries()).map(([category, files]) => ({
      category,
      count: files.size,
      files: Array.from(files)
    })).sort((a, b) => a.category.localeCompare(b.category));

    return this._cachedCategories;
  }

  /**
   * Get all indexed notes.
   */
  getAllNotes() {
    return Array.from(this.fileIndex.values());
  }

  /**
   * Generates graph nodes and links for global or local graph view.
   * Uses pre-resolved link targets for O(1) lookups instead of re-resolving.
   */
  getGraphData(activeFilePath = null, maxDepth = 0) {
    const rawNodes = new Map();
    const rawLinks = [];

    // First pass: collect all notes as potential nodes
    for (const [filePath, meta] of this.fileIndex.entries()) {
      rawNodes.set(filePath, {
        id: filePath,
        label: meta.title || meta.baseName,
        baseName: meta.baseName,
        relativePath: meta.relativePath,
        filePath,
        tags: Array.from(meta.tags),
        categories: Array.from(meta.categories),
        inDegree: 0,
        outDegree: 0,
        isCurrent: activeFilePath ? filePath === activeFilePath : false
      });
    }

    // Second pass: use pre-resolved link targets (no filesystem I/O)
    const adjacency = new Map();
    for (const filePath of rawNodes.keys()) {
      adjacency.set(filePath, new Set());
    }

    for (const [sourcePath, meta] of this.fileIndex.entries()) {
      const sourceNode = rawNodes.get(sourcePath);
      if (!sourceNode) continue;

      const resolvedLinks = meta.resolvedLinks || [];
      for (const { link, targetPath } of resolvedLinks) {
        if (rawNodes.has(targetPath) && targetPath !== sourcePath) {
          const targetNode = rawNodes.get(targetPath);
          sourceNode.outDegree++;
          targetNode.inDegree++;

          rawLinks.push({
            source: sourcePath,
            target: targetPath,
            label: link.alias || link.heading || ''
          });

          adjacency.get(sourcePath).add(targetPath);
          adjacency.get(targetPath).add(sourcePath);
        }
      }
    }

    // Local Graph filtering if activeFilePath and maxDepth > 0
    let filteredNodes = rawNodes;
    let filteredLinks = rawLinks;

    if (activeFilePath && maxDepth > 0 && rawNodes.has(activeFilePath)) {
      const reachable = new Set([activeFilePath]);
      let currentLevel = [activeFilePath];

      for (let depth = 0; depth < maxDepth; depth++) {
        const nextLevel = [];
        for (const node of currentLevel) {
          const neighbors = adjacency.get(node);
          if (!neighbors) continue;
          for (const neighbor of neighbors) {
            if (!reachable.has(neighbor)) {
              reachable.add(neighbor);
              nextLevel.push(neighbor);
            }
          }
        }
        currentLevel = nextLevel;
        if (currentLevel.length === 0) break;
      }

      filteredNodes = new Map();
      for (const p of reachable) {
        filteredNodes.set(p, rawNodes.get(p));
      }

      filteredLinks = rawLinks.filter(l => 
        reachable.has(typeof l.source === 'string' ? l.source : l.source.id) &&
        reachable.has(typeof l.target === 'string' ? l.target : l.target.id)
      );
    }

    const nodesList = Array.from(filteredNodes.values()).map(n => ({
      ...n,
      linkCount: n.inDegree + n.outDegree
    }));

    return {
      nodes: nodesList,
      links: filteredLinks
    };
  }

  dispose() {
    // Clear all per-file debounce timers
    for (const timerId of this._debounceTimers.values()) {
      clearTimeout(timerId);
    }
    this._debounceTimers.clear();

    // Dispose event subscriptions
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;

    if (this._watcher) {
      this._watcher.dispose();
      this._watcher = null;
    }
    this._onDidChangeIndex.dispose();

    // Release index memory
    this.fileIndex.clear();
    this.tagIndex.clear();
    this.categoryIndex.clear();
    this.titleToPathIndex.clear();
    this._cachedTags = null;
    this._cachedCategories = null;
  }
}

module.exports = {
  WorkspaceNotesIndexer,
  parseFrontmatter,
  extractInlineTags,
  extractHeadings,
  extractWikilinks,
  parseWikilinkTarget,
  sanitizeContentForTags
};
