/**
 * MarkGarden MCP Server (stdio)
 *
 * A standalone Model Context Protocol server that ships inside the MarkGarden
 * VS Code extension. It runs as a child process launched by VS Code and gives
 * AI agents (Copilot agent mode, etc.) structured access to:
 *
 *  - markgarden_help      : Full usage guide for every MarkGarden feature/command
 *  - list_notes           : All markdown notes in the workspace
 *  - get_note             : Full content + metadata of one note
 *  - list_tags            : All tags with note counts
 *  - list_categories      : All categories with note counts
 *  - find_notes_by_tag    : Notes carrying a given tag
 *  - find_notes_by_category : Notes carrying a given category
 *  - search_notes         : Case-insensitive substring search across note contents
 *
 * The workspace folder is passed by the extension host via the
 * MARKGARDEN_WORKSPACE environment variable.
 */
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const WORKSPACE = process.env.MARKGARDEN_WORKSPACE || process.cwd();

// ---------------------------------------------------------------------------
// Lightweight workspace scanning (no vscode API available in this process)
// ---------------------------------------------------------------------------

/** Default folders that are noise for a knowledge garden. */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.vscode', '.obsidian', '.trash', 'coverage', 'dist']);

function* walkMarkdown(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(full, depth + 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      yield full;
    }
  }
}

function listNoteFiles() {
  return Array.from(walkMarkdown(WORKSPACE)).sort();
}

function readNote(absPath) {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/** Minimal YAML frontmatter extraction: top-level scalar keys + tags/categories lists. */
function parseFrontmatter(content) {
  const result = {};
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return result;
  let currentKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv && !line.startsWith(' ') && !line.startsWith('-')) {
      currentKey = kv[1];
      let val = kv[2].trim();
      if (val === '') continue; // may be followed by list items
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // inline arrays: [a, b]
      if (val.startsWith('[') && val.endsWith(']')) {
        result[currentKey] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        result[currentKey] = val;
      }
    } else if (currentKey && line.match(/^\s+-\s+(.+)$/)) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(line.match(/^\s+-\s+(.+)$/)[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return result;
}

/** Inline #hashtags found in the body (frontmatter stripped). */
function extractInlineTags(content) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const tags = new Set();
  for (const m of body.matchAll(/(?:^|\s)#([\w][\w/-]*)/g)) {
    tags.add(m[1]);
  }
  return Array.from(tags);
}

function collectTagsCategories() {
  const tags = new Map();
  const cats = new Map();
  for (const file of listNoteFiles()) {
    const content = readNote(file);
    const fm = parseFrontmatter(content);
    const rel = path.relative(WORKSPACE, file);
    const add = (map, values) => {
      for (const v of values || []) {
        const key = String(v).trim();
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(rel);
      }
    };
    const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(/\s+/) : []);
    add(tags, [...new Set([...fmTags, ...extractInlineTags(content)])]);
    const fmCats = Array.isArray(fm.categories) ? fm.categories : (fm.categories ? [fm.categories] : []);
    add(cats, fmCats);
  }
  const toSorted = map => Array.from(map.entries())
    .map(([name, files]) => ({ name, count: files.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags: toSorted(tags), categories: toSorted(cats) };
}

function notesWithTaxonomy(kind, name) {
  const target = String(name).toLowerCase();
  const hits = [];
  for (const file of listNoteFiles()) {
    const content = readNote(file);
    const fm = parseFrontmatter(content);
    let values = kind === 'tag' ? [] : [];
    if (kind === 'tag') {
      const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(/\s+/) : []);
      values = [...fmTags, ...extractInlineTags(content)];
    } else {
      values = Array.isArray(fm.categories) ? fm.categories : (fm.categories ? [fm.categories] : []);
    }
    if (values.some(v => String(v).toLowerCase() === target)) {
      hits.push(path.relative(WORKSPACE, file));
    }
  }
  return hits;
}

function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Help content — the core "help/mcp" feature: teaches agents what users can do
// ---------------------------------------------------------------------------
const HELP_GUIDE = `# MarkGarden — AI Guide

MarkGarden turns any VS Code workspace into an Obsidian-style digital garden /
personal knowledge management (PKM) system over plain Markdown notes.

## What users can do (and how to help them)

### Wikilinks & navigation
- Write \`[[Note Name]]\` to link notes; \`[[Note Name|alias]]\` for display text,
  \`[[Note#Heading]]\` for headings, \`[[Note^block-id]]\` for blocks.
- Autocomplete appears while typing \`[[\`; hover shows a rich preview.
- Commands: "Follow Link Under Cursor" (\`markgarden.openLinkAtCursor\`),
  "Open Graph View", "Open Local Graph View".
- Following a link to a non-existent note creates it (folder strategy configurable).

### Backlinks & unlinked mentions
- Sidebar panel shows every note linking to the active note, plus unlinked
  mentions that can be converted to wikilinks with one click.
- Renaming/moving notes auto-rewrites inbound \`[[wikilinks]]\`
  (setting: markgarden.wikilinks.autoUpdateOnRename).

### Tags & categories
- Tags live in frontmatter (\`tags: [a, b]\`) or inline as \`#hashtag\`;
  categories are frontmatter-only (\`categories: [...]\`).
- Sidebar panels browse both; commands: Add/Remove/Rename Tag,
  Add/Remove/Rename Category, Find Notes by Tag/Category.
- Use the list_tags / find_notes_by_tag tools here to query the vault for the user.

### Frontmatter management
- Property autocomplete inside frontmatter; commands: Add/Set Property,
  Format Frontmatter, Rename Property Across Workspace,
  Convert Inline Tags to Frontmatter, Sync Note Title with Filename.
- "updated" date auto-refreshes on save.

### Daily notes & templates
- "Create Daily Note" makes/opens today's note from a template
  (folders/format configurable via markgarden.dailyNotesFolder, .dateFormat,
  .dailyNoteTemplate, .templatesFolder).
- "Insert Template" inserts a template with {{date}}, {{time}}, {{title}} style variables.

### Callouts (Obsidian-compatible)
- "> [!note] Title" style callouts render in preview and get gutter styling;
  command "Insert Callout".

### Digital garden lifecycle
- Each note has a publish status and growth stage (seedling/budding/evergreen).
- Status bar shows current state; commands: Toggle Publish Status,
  Set Growth Stage, Run Garden Audit (vault-wide health report),
  plus a sidebar Digital Garden tree view.

### Refactoring
- "Extract Selection to Note" moves selected text into a new note,
  leaving a wikilink behind (Zettelkasten workflow).

## How you (the agent) can help
- When the user asks what MarkGarden can do, answer from this guide.
- To reason about their vault, use your other markgarden tools: list_notes,
  get_note, search_notes, list_tags, list_categories, find_notes_by_tag,
  find_notes_by_category. Prefer these over reading raw files blindly.
- Suggest specific commands (Command Palette -> "MarkGarden: ...") when the
  user wants an action performed manually.`;

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new McpServer({ name: 'MarkGarden MCP', version: '1.0.0' });

server.registerTool('markgarden_help', {
  title: 'MarkGarden Help',
  description: 'Returns the full usage guide for the MarkGarden VS Code extension: every feature (wikilinks, backlinks, tags, categories, frontmatter, daily notes, templates, callouts, graph view, digital garden lifecycle) and how an AI assistant should use the other markgarden tools.',
  inputSchema: z.object({})
}, async () => ({ content: [{ type: 'text', text: HELP_GUIDE }] }));

server.registerTool('list_notes', {
  title: 'List Notes',
  description: 'List all Markdown notes in the workspace with title, aliases, tags, categories, and word count.',
  inputSchema: z.object({})
}, async () => {
  const notes = listNoteFiles().map(file => {
    const content = readNote(file);
    const fm = parseFrontmatter(content);
    return {
      path: path.relative(WORKSPACE, file),
      title: fm.title || path.basename(file, '.md'),
      aliases: Array.isArray(fm.aliases) ? fm.aliases : (fm.aliases ? [fm.aliases] : []),
      tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(/\s+/) : []),
      categories: Array.isArray(fm.categories) ? fm.categories : (fm.categories ? [fm.categories] : []),
      words: content.split(/\s+/).filter(Boolean).length
    };
  });
  return json({ count: notes.length, notes });
});

server.registerTool('get_note', {
  title: 'Get Note',
  description: 'Return the full content of one note, given its workspace-relative path (as returned by list_notes).',
  inputSchema: { path: z.string().describe('Workspace-relative path of the note, e.g. "notes/idea.md"') }
}, async ({ path: rel }) => {
  const abs = path.resolve(WORKSPACE, rel);
  if (!abs.startsWith(path.resolve(WORKSPACE))) {
    return { isError: true, content: [{ type: 'text', text: 'Path escapes the workspace.' }] };
  }
  const content = readNote(abs);
  if (!content && !fs.existsSync(abs)) {
    return { isError: true, content: [{ type: 'text', text: `Note not found: ${rel}` }] };
  }
  return { content: [{ type: 'text', text: content }] };
});

server.registerTool('list_tags', {
  title: 'List Tags',
  description: 'List every tag in the vault (frontmatter + inline hashtags) with note counts, sorted by frequency.',
  inputSchema: z.object({})
}, async () => json(collectTagsCategories().tags));

server.registerTool('list_categories', {
  title: 'List Categories',
  description: 'List every category in the vault (frontmatter) with note counts, sorted by frequency.',
  inputSchema: z.object({})
}, async () => json(collectTagsCategories().categories));

server.registerTool('find_notes_by_tag', {
  title: 'Find Notes by Tag',
  description: 'Return the paths of all notes carrying a given tag (case-insensitive).',
  inputSchema: { tag: z.string().describe('Tag name without the # prefix') }
}, async ({ tag }) => json({ tag, notes: notesWithTaxonomy('tag', tag) }));

server.registerTool('find_notes_by_category', {
  title: 'Find Notes by Category',
  description: 'Return the paths of all notes carrying a given frontmatter category (case-insensitive).',
  inputSchema: { category: z.string().describe('Category name') }
}, async ({ category }) => json({ category, notes: notesWithTaxonomy('category', category) }));

server.registerTool('search_notes', {
  title: 'Search Notes',
  description: 'Case-insensitive substring search across the full content of all notes. Returns matching notes with surrounding context lines.',
  inputSchema: {
    query: z.string().describe('Text to search for'),
    limit: z.number().optional().describe('Max results (default 20)')
  }
}, async ({ query, limit }) => {
  const max = Math.min(Number(limit) || 20, 100);
  const needle = String(query).toLowerCase();
  const hits = [];
  for (const file of listNoteFiles()) {
    if (hits.length >= max) break;
    const content = readNote(file);
    const idx = content.toLowerCase().indexOf(needle);
    if (idx === -1) continue;
    const start = content.lastIndexOf('\n', Math.max(0, idx - 80));
    const snippet = content.slice(Math.max(0, start), idx + needle.length + 120).trim();
    hits.push({ path: path.relative(WORKSPACE, file), snippet });
  }
  return json({ query, matches: hits.length, results: hits });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('[markgarden-mcp] fatal:', err.message);
  process.exit(1);
});
