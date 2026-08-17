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
    let val = rawLine.slice(colonIdx + 1).trim();

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
 * Strips code blocks, inline code, HTML comments, and URLs from markdown text
 * so hashtag parsing doesn't match false positives.
 */
function sanitizeContentForTags(content) {
  // Replace frontmatter with empty lines to preserve line count if needed
  let sanitized = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  // Remove fenced code blocks ``` ... ``` and ~~~ ... ~~~
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
  sanitized = sanitized.replace(/~~~[\s\S]*?~~~/g, '');
  // Remove HTML comments <!-- ... -->
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
  // Remove inline code `...`
  sanitized = sanitized.replace(/`[^`\r\n]+`/g, '');
  // Remove URLs e.g. https://... or http://...
  sanitized = sanitized.replace(/https?:\/\/[^\s)]+/g, '');
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
    this.fileIndex = new Map(); // filePath -> { title, relativePath, headings, tags, categories, links }
    this.tagIndex = new Map(); // tag -> Set<filePath>
    this.categoryIndex = new Map(); // category -> Set<filePath>
    this.titleToPathIndex = new Map(); // lowercase note name (without .md) -> Set<filePath>
    
    this._onDidChangeIndex = new vscode.EventEmitter();
    this.onDidChangeIndex = this._onDidChangeIndex.event;
    
    this.isIndexing = false;
    this.watcher = null;
    this.debounceTimer = null;
  }

  /**
   * Initializes indexer, builds initial index, and sets up file system watchers.
   */
  async initialize(context) {
    await this.rebuildIndex();

    // Create file system watcher for markdown files
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    this.watcher.onDidCreate(uri => this.handleFileChange(uri.fsPath), this, context.subscriptions);
    this.watcher.onDidChange(uri => this.handleFileChange(uri.fsPath), this, context.subscriptions);
    this.watcher.onDidDelete(uri => this.handleFileDelete(uri.fsPath), this, context.subscriptions);

    // Watch for configuration changes that might affect exclusions or folders
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('obsidian-notes')) {
          this.rebuildIndex();
        }
      })
    );

    context.subscriptions.push(this.watcher);
    context.subscriptions.push(this._onDidChangeIndex);
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

    for (const fileUri of files) {
      try {
        const content = fs.readFileSync(fileUri.fsPath, 'utf8');
        this.indexFileContent(fileUri.fsPath, content);
      } catch {
        // Skip unreadable files
      }
    }

    this.isIndexing = false;
    this._onDidChangeIndex.fire();
  }

  /**
   * Handles real-time file update with debounce.
   */
  handleFileChange(filePath) {
    if (!filePath.endsWith('.md')) return;
    if (this.shouldIgnore(filePath)) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          this.removeFileFromIndices(filePath);
          this.indexFileContent(filePath, content);
          this._onDidChangeIndex.fire();
        }
      } catch {
        // Handle race conditions where file was removed before read
      }
    }, 150);
  }

  /**
   * Handles real-time file deletion.
   */
  handleFileDelete(filePath) {
    this.removeFileFromIndices(filePath);
    this.fileIndex.delete(filePath);
    this._onDidChangeIndex.fire();
  }

  /**
   * Check if a path matches common exclusion directories.
   */
  shouldIgnore(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.includes('/node_modules/') ||
           normalized.includes('/.git/') ||
           normalized.includes('/.vscode/') ||
           normalized.includes('/dist/') ||
           normalized.includes('/out/');
  }

  /**
   * Indexes a single markdown file's contents.
   */
  indexFileContent(filePath, content) {
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

    // Record file entry
    const meta = {
      filePath,
      relativePath,
      baseName,
      title,
      headings,
      tags: allTags,
      categories: frontmatter.categories,
      links: wikilinks,
      frontmatter
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

  /**
   * Removes a file from inverted indices before re-indexing or after deletion.
   */
  removeFileFromIndices(filePath) {
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

    if (existing.frontmatter && existing.frontmatter.title) {
      const titleKey = existing.frontmatter.title.toLowerCase();
      const titleSet = this.titleToPathIndex.get(titleKey);
      if (titleSet) {
        titleSet.delete(filePath);
        if (titleSet.size === 0) this.titleToPathIndex.delete(titleKey);
      }
    }
  }

  /**
   * Resolves a target note name to an absolute file path.
   * Matches by relative path, exact base name, frontmatter title, or case-insensitive name.
   */
  resolveNotePath(targetNote, sourceFilePath) {
    if (!targetNote) return null;
    let clean = targetNote.trim();
    if (clean.endsWith('.md')) {
      clean = clean.slice(0, -3);
    }

    // 1. Direct match by path relative to source file directory or workspace
    if (sourceFilePath) {
      const sourceDir = path.dirname(sourceFilePath);
      const relativeCandidate = path.join(sourceDir, `${clean}.md`);
      if (fs.existsSync(relativeCandidate)) {
        return relativeCandidate;
      }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const wf of workspaceFolders) {
        const candidate = path.join(wf.uri.fsPath, `${clean}.md`);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    // 2. Lookup in index
    const key = clean.toLowerCase();
    const matches = this.titleToPathIndex.get(key);
    if (matches && matches.size > 0) {
      return matches.values().next().value;
    }

    // 3. Fallback: Normalized match ignoring spaces, dashes, and underscores
    const normalizedTarget = key.replace(/[\s\-_]/g, '');
    for (const [indexedKey, paths] of this.titleToPathIndex.entries()) {
      if (indexedKey.replace(/[\s\-_]/g, '') === normalizedTarget && paths.size > 0) {
        return paths.values().next().value;
      }
    }

    return null;
  }

  /**
   * Get all indexed tags and their note counts.
   */
  getAllTags() {
    return Array.from(this.tagIndex.entries()).map(([tag, files]) => ({
      tag,
      count: files.size,
      files: Array.from(files)
    })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  /**
   * Get all indexed categories and their note counts.
   */
  getAllCategories() {
    return Array.from(this.categoryIndex.entries()).map(([category, files]) => ({
      category,
      count: files.size,
      files: Array.from(files)
    })).sort((a, b) => a.category.localeCompare(b.category));
  }

  /**
   * Get all indexed notes.
   */
  getAllNotes() {
    return Array.from(this.fileIndex.values());
  }

  /**
   * Generates graph nodes and links for global or local graph view.
   * If activeFilePath is provided and maxDepth > 0, returns a local subgraph around that file.
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
        filePath: filePath,
        tags: Array.from(meta.tags),
        categories: Array.from(meta.categories),
        inDegree: 0,
        outDegree: 0,
        isCurrent: activeFilePath ? filePath === activeFilePath : false
      });
    }

    // Second pass: resolve outbound links to target files
    const adjacency = new Map(); // filePath -> Set<neighborFilePath>
    for (const filePath of rawNodes.keys()) {
      adjacency.set(filePath, new Set());
    }

    for (const [sourcePath, meta] of this.fileIndex.entries()) {
      const sourceNode = rawNodes.get(sourcePath);
      if (!sourceNode) continue;

      const links = meta.links || [];
      for (const link of links) {
        if (!link.targetNote) continue; // Skip local heading-only links
        const targetPath = this.resolveNotePath(link.targetNote, sourcePath);
        if (targetPath && rawNodes.has(targetPath) && targetPath !== sourcePath) {
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
          const neighbors = adjacency.get(node) || [];
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
    if (this.watcher) this.watcher.dispose();
    this._onDidChangeIndex.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
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
