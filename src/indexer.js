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
    aliases: new Set(),
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
        } else if (currentKey === 'aliases' || currentKey === 'alias') {
          result.aliases.add(itemVal);
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
    } else if (key === 'aliases' || key === 'alias') {
      currentKey = 'aliases';
      if (val) {
        const cleaned = val.replace(/[[\]]/g, '');
        cleaned.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(a => result.aliases.add(a));
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
 * Extracts block references (^block-id) from markdown content.
 * Returns array of { id, line, text }
 */
function extractBlockReferences(content) {
  const blocks = [];
  const lines = content.split(/\r?\n/);
  const blockRegex = /(?:^|[ \t]+)\^([a-zA-Z0-9_-]+)[ \t]*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(blockRegex);
    if (match) {
      const blockId = match[1];
      // Strip the trailing ^blockId marker for display/content
      const cleanText = line.replace(blockRegex, '').trim();
      blocks.push({
        id: blockId,
        line: i,
        text: cleanText || line.trim()
      });
    }
  }
  return blocks;
}

/**
 * Extracts the content under a specific heading up to the next heading of same or higher level.
 */
function extractHeadingSection(content, headingText) {
  if (!content || !headingText) return null;
  const headings = extractHeadings(content);
  const targetHeading = headings.find(h => h.text.toLowerCase() === headingText.toLowerCase());
  if (!targetHeading) return null;

  const lines = content.split(/\r?\n/);
  const startLine = targetHeading.line;
  let endLine = lines.length;

  for (const h of headings) {
    if (h.line > startLine && h.level <= targetHeading.level) {
      endLine = h.line;
      break;
    }
  }

  const sectionLines = lines.slice(startLine, endLine);
  return {
    heading: targetHeading,
    content: sectionLines.join('\n').trim()
  };
}

/**
 * Extracts content of a specific block by blockId (^block-id).
 */
function extractBlockContent(content, blockId) {
  if (!content || !blockId) return null;
  const blocks = extractBlockReferences(content);
  const cleanId = blockId.startsWith('^') ? blockId.slice(1) : blockId;
  const targetBlock = blocks.find(b => b.id.toLowerCase() === cleanId.toLowerCase());
  return targetBlock || null;
}

const MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
  'mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'aac',
  'mp4', 'webm', 'ogv', 'mov', 'mkv',
  'pdf'
]);

/**
 * Checks if a target filename is an embedded image or media attachment.
 */
function isMediaFile(filename) {
  if (!filename) return false;
  const clean = filename.split('|')[0].trim().split('#')[0].trim();
  const ext = path.extname(clean).toLowerCase().replace(/^\./, '');
  return MEDIA_EXTENSIONS.has(ext);
}

/**
 * Parses wikilink string (e.g. "Note Name#Section|Alias" or "Note#^block-id") into components.
 */
function parseWikilinkTarget(rawLink) {
  let text = rawLink.trim();
  let alias = '';
  let heading = '';
  let blockId = '';
  let targetNote = '';

  // Check for alias: [[target|alias]] or [[target\|alias]]
  const pipeIdx = text.indexOf('|');
  if (pipeIdx !== -1) {
    alias = text.slice(pipeIdx + 1).trim();
    text = text.slice(0, pipeIdx).trim();
  }

  // Check for heading or block anchor: [[target#heading]] or [[target#^block-id]]
  const hashIdx = text.indexOf('#');
  if (hashIdx !== -1) {
    const anchor = text.slice(hashIdx + 1).trim();
    if (anchor.startsWith('^')) {
      blockId = anchor.slice(1).trim();
    } else {
      heading = anchor;
    }
    targetNote = text.slice(0, hashIdx).trim();
  } else {
    targetNote = text.trim();
  }

  const isMedia = isMediaFile(targetNote);

  return {
    raw: rawLink,
    targetNote,
    heading,
    blockId,
    alias,
    isMedia
  };
}

/**
 * Helper to determine if the first H1 heading is a document title heading
 * (i.e. appears at the top of the note before any body content).
 */
function findPrimaryDocHeading(content, headings) {
  if (!headings || headings.length === 0 || headings[0].level !== 1) {
    return '';
  }

  const targetLineIndex = headings[0].line;
  const lines = content.split(/\r?\n/);

  // Determine end of frontmatter if present
  let bodyStartLine = 0;
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (fmMatch) {
    bodyStartLine = fmMatch[0].split(/\r?\n/).length;
  }

  // Check all lines between frontmatter end and target heading line
  for (let i = bodyStartLine; i < targetLineIndex; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('#')) {
      // Non-heading body text exists prior to this H1, so it's a section header, not doc title
      return '';
    }
  }

  return headings[0].text;
}

/**
 * Extracts all outbound wikilinks and transclusion embeds from markdown content.
 * Filters out media file attachments (images, PDFs, audio/video).
 */
function extractWikilinks(content) {
  // Mask frontmatter, code blocks, and comments with spaces to preserve line numbers and character offsets
  let sanitized = content.replace(/^---\r?\n[\s\S]*?\r?\n---|```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  sanitized = sanitized.replace(/`[^`\r\n]+`/g, m => ' '.repeat(m.length));

  const links = [];
  const regex = /(!?\[\[)([^[\r\n\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(sanitized)) !== null) {
    const isEmbed = match[1] === '![[';
    const parsed = parseWikilinkTarget(match[2]);
    if (!parsed.isMedia) {
      const charIndex = match.index;
      const lineNumber = content.slice(0, charIndex).split(/\r?\n/).length - 1;
      parsed.index = charIndex;
      parsed.line = lineNumber;
      parsed.isEmbed = isEmbed;
      links.push(parsed);
    }
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
    this.mediaToPathIndex = new Map(); // lowercase media basename -> Set<filePath>
    
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

    // Create file system watcher for markdown and media files
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,png,jpg,jpeg,gif,svg,webp,bmp,ico,pdf,mp3,mp4,wav,webm}');

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
   * Full scan of workspace for markdown and media files.
   */
  async rebuildIndex() {
    this.isIndexing = true;
    this.fileIndex.clear();
    this.tagIndex.clear();
    this.categoryIndex.clear();
    this.titleToPathIndex.clear();
    this.mediaToPathIndex.clear();
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

    // Scan media files
    const mediaFiles = await vscode.workspace.findFiles('**/*.{png,jpg,jpeg,gif,svg,webp,bmp,ico,pdf,mp3,mp4,wav,webm}', excludePattern);
    for (const fileUri of mediaFiles) {
      const fsPath = fileUri.fsPath;
      const baseName = path.basename(fsPath).toLowerCase();
      if (!this.mediaToPathIndex.has(baseName)) {
        this.mediaToPathIndex.set(baseName, new Set());
      }
      this.mediaToPathIndex.get(baseName).add(fsPath);
    }

    // Scan markdown files
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
   * Resolves a media file path by target filename.
   */
  resolveMediaPath(targetMedia, sourceFilePath) {
    if (!targetMedia) return null;
    let clean = targetMedia.trim();
    const pipeIdx = clean.indexOf('|');
    if (pipeIdx !== -1) clean = clean.slice(0, pipeIdx).trim();
    const hashIdx = clean.indexOf('#');
    if (hashIdx !== -1) clean = clean.slice(0, hashIdx).trim();

    const baseName = path.basename(clean).toLowerCase();
    const matches = this.mediaToPathIndex.get(baseName);

    if (matches && matches.size > 0) {
      if (sourceFilePath) {
        const sourceDir = path.dirname(sourceFilePath);
        for (const candidate of matches) {
          if (path.dirname(candidate) === sourceDir) {
            return candidate;
          }
        }
      }
      return matches.values().next().value;
    }

    return null;
  }

  /**
   * Get list of all indexed media file entries.
   */
  getAllMediaFiles() {
    const results = [];
    for (const [baseName, paths] of this.mediaToPathIndex.entries()) {
      for (const p of paths) {
        results.push({
          baseName,
          filePath: p
        });
      }
    }
    return results;
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
    const primaryHeading = findPrimaryDocHeading(content, headings);
    const title = frontmatter.title || primaryHeading || baseName;

    const wikilinks = extractWikilinks(content);
    const blocks = extractBlockReferences(content);
    const blockMap = new Map();
    for (const b of blocks) {
      blockMap.set(b.id.toLowerCase(), b);
    }

    // Record file entry — store only what's needed, not the full frontmatter object
    const meta = {
      filePath,
      relativePath,
      baseName,
      title,
      frontmatterTitle: frontmatter.title || '',
      aliases: Array.from(frontmatter.aliases),
      headings,
      tags: allTags,
      categories: frontmatter.categories,
      links: wikilinks,
      blocks,
      blockMap,
      resolvedLinks: [], // populated by _resolveLinksForFile
      _contentLines: content.split(/\r?\n/)
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
    } else if (primaryHeading) {
      const h1Key = primaryHeading.toLowerCase();
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

  /**
   * Returns linked references (backlinks) pointing to targetFilePath.
   * Format: Array of { sourceFilePath, title, relativePath, snippets: [{ line, lineText, link }] }
   */
  async getBacklinksForFile(targetFilePath) {
    if (!targetFilePath || !this.fileIndex.has(targetFilePath)) {
      return [];
    }

    const backlinks = [];

    for (const [sourcePath, meta] of this.fileIndex.entries()) {
      if (sourcePath === targetFilePath) continue;

      const matchingResolved = (meta.resolvedLinks || []).filter(r => r.targetPath === targetFilePath);
      if (matchingResolved.length === 0) continue;

      let fileLines = meta._contentLines;
      if (!fileLines) {
        try {
          const content = await fs.promises.readFile(sourcePath, 'utf8');
          fileLines = content.split(/\r?\n/);
        } catch {
          fileLines = [];
        }
      }

      const snippets = [];
      for (const { link } of matchingResolved) {
        const lineIdx = link.line !== undefined ? link.line : 0;
        const lineText = fileLines && fileLines[lineIdx] !== undefined ? fileLines[lineIdx].trim() : `[[${link.raw}]]`;
        snippets.push({
          line: lineIdx,
          lineText,
          link
        });
      }

      backlinks.push({
        sourceFilePath: sourcePath,
        title: meta.title || meta.baseName,
        relativePath: meta.relativePath,
        snippets
      });
    }

    return backlinks;
  }

  /**
   * Finds unlinked mentions of targetFilePath's title, baseName, or frontmatter aliases in workspace notes.
   * Format: Array of { sourceFilePath, title, relativePath, mentions: [{ line, lineText, term, matchStart, targetNote }] }
   */
  async getUnlinkedMentionsForFile(targetFilePath) {
    if (!targetFilePath || !this.fileIndex.has(targetFilePath)) {
      return [];
    }

    const targetMeta = this.fileIndex.get(targetFilePath);
    const searchTerms = new Set();
    if (targetMeta.baseName && targetMeta.baseName.length >= 2) searchTerms.add(targetMeta.baseName);
    if (targetMeta.title && targetMeta.title.length >= 2) searchTerms.add(targetMeta.title);
    if (targetMeta.frontmatterTitle && targetMeta.frontmatterTitle.length >= 2) searchTerms.add(targetMeta.frontmatterTitle);
    if (targetMeta.aliases) {
      for (const alias of targetMeta.aliases) {
        if (alias && alias.length >= 2) searchTerms.add(alias);
      }
    }

    if (searchTerms.size === 0) return [];

    const unlinkedResults = [];

    const termPatterns = Array.from(searchTerms)
      .sort((a, b) => b.length - a.length)
      .map(term => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          term,
          regex: new RegExp(`\\b${escaped}\\b`, 'gi')
        };
      });

    for (const [sourcePath, meta] of this.fileIndex.entries()) {
      if (sourcePath === targetFilePath) continue;

      let content;
      if (meta._contentLines) {
        content = meta._contentLines.join('\n');
      } else {
        try {
          content = await fs.promises.readFile(sourcePath, 'utf8');
        } catch {
          continue;
        }
      }

      let sanitized = content.replace(/^---\r?\n[\s\S]*?\r?\n---|```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
      sanitized = sanitized.replace(/`[^`\r\n]+`/g, m => ' '.repeat(m.length));
      sanitized = sanitized.replace(/\[\[[^[\r\n\]]+\]\]/g, m => ' '.repeat(m.length));
      sanitized = sanitized.replace(/^[ \t]*#{1,6}[ \t]+.*$/gm, m => ' '.repeat(m.length));

      const originalLines = content.split(/\r?\n/);
      const sanitizedLines = sanitized.split(/\r?\n/);
      const mentions = [];

      for (let i = 0; i < sanitizedLines.length; i++) {
        const lineStr = sanitizedLines[i];
        if (!lineStr.trim()) continue;

        const matchedRangesOnLine = [];

        for (const { term, regex } of termPatterns) {
          regex.lastIndex = 0;
          let m;
          while ((m = regex.exec(lineStr)) !== null) {
            const start = m.index;
            const end = m.index + m[0].length;

            // Check if this match overlaps with a longer term already matched on this line
            const overlaps = matchedRangesOnLine.some(r => !(end <= r.start || start >= r.end));
            if (overlaps) continue;

            matchedRangesOnLine.push({ start, end });

            mentions.push({
              line: i,
              lineText: originalLines[i] ? originalLines[i].trim() : lineStr.trim(),
              term,
              matchStart: start,
              targetNote: targetMeta.baseName
            });
            if (mentions.length >= 10) break;
          }
          if (mentions.length >= 10) break;
        }
      }

      if (mentions.length > 0) {
        unlinkedResults.push({
          sourceFilePath: sourcePath,
          title: meta.title || meta.baseName,
          relativePath: meta.relativePath,
          mentions
        });
      }
    }

    return unlinkedResults;
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
  extractBlockReferences,
  extractHeadingSection,
  extractBlockContent,
  parseWikilinkTarget,
  findPrimaryDocHeading,
  isMediaFile,
  sanitizeContentForTags
};
