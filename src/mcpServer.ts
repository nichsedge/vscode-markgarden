/**
 * MarkGarden MCP Server (stdio)
 *
 * A standalone Model Context Protocol server that ships inside the MarkGarden
 * VS Code extension. It runs as a child process launched by VS Code and gives
 * AI agents (Copilot agent mode, etc.) structured access to:
 *
 *  - markgarden_help        : Full usage guide for every MarkGarden feature/command
 *  - list_notes             : All markdown notes in the workspace
 *  - get_note               : Full content + metadata of one note
 *  - list_tags              : All tags with note counts
 *  - list_categories        : All categories with note counts
 *  - find_notes_by_tag      : Notes carrying a given tag
 *  - find_notes_by_category : Notes carrying a given category
 *  - search_notes           : Case-insensitive substring search across note contents
 *  - get_backlinks          : Inbound wikilinks and unlinked mentions for a note
 *  - get_outgoing_links     : Outbound wikilinks and transclusion embeds from a note
 *  - get_vault_audit        : Digital garden audit report (growth, privacy leaks, orphans, broken links)
 *  - create_note            : Create a new note with optional frontmatter and title
 *  - append_daily_note      : Append a log entry or task to today's daily note
 *
 * The workspace folder is passed by the extension host via the
 * MARKGARDEN_WORKSPACE environment variable.
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  parseFrontmatter as parseFmUtil,
  extractInlineTags as extractInlineTagsUtil,
  extractWikilinks as extractWikilinksUtil,
  stripQuotes
} from './parserUtils';

const WORKSPACE = process.env.MARKGARDEN_WORKSPACE || process.cwd();

// ---------------------------------------------------------------------------
// Lightweight workspace scanning (no vscode API available in this process)
// ---------------------------------------------------------------------------

/** Default folders that are noise for a knowledge garden. */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.vscode', '.obsidian', '.trash', 'coverage', 'dist']);

function* walkMarkdown(dir: string, depth = 0): Generator<string> {
  if (depth > 12) return;
  let entries: fs.Dirent[];
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

function listNoteFiles(): string[] {
  return Array.from(walkMarkdown(WORKSPACE)).sort();
}

function readNote(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/** Converts parsed frontmatter map and sets to a plain JSON-serializable record. */
function parseFrontmatterRecord(content: string): Record<string, any> {
  const parsed = parseFmUtil(content);
  const rec: Record<string, any> = {
    title: parsed.title,
    tags: Array.from(parsed.tags),
    categories: Array.from(parsed.categories),
    aliases: Array.from(parsed.aliases)
  };
  for (const [k, v] of parsed.properties.entries()) {
    rec[k] = v;
  }
  return rec;
}

function collectTagsCategories() {
  const tags = new Map<string, string[]>();
  const cats = new Map<string, string[]>();
  for (const file of listNoteFiles()) {
    const content = readNote(file);
    const fm = parseFrontmatterRecord(content);
    const rel = path.relative(WORKSPACE, file);
    const add = (map: Map<string, string[]>, values: any[]) => {
      for (const v of values || []) {
        const key = String(v).trim();
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(rel);
      }
    };
    const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(/\s+/) : []);
    const inline = Array.from(extractInlineTagsUtil(content));
    add(tags, [...new Set([...fmTags, ...inline])]);
    const fmCats = Array.isArray(fm.categories) ? fm.categories : (fm.categories ? [fm.categories] : []);
    add(cats, fmCats);
  }
  const toSorted = (map: Map<string, string[]>) => Array.from(map.entries())
    .map(([name, files]) => ({ name, count: files.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags: toSorted(tags), categories: toSorted(cats) };
}

function notesWithTaxonomy(kind: string, name: string) {
  const target = String(name).toLowerCase();
  const hits: string[] = [];
  for (const file of listNoteFiles()) {
    const content = readNote(file);
    const fm = parseFrontmatterRecord(content);
    let values: any[] = [];
    if (kind === 'tag') {
      const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(/\s+/) : []);
      values = [...fmTags, ...Array.from(extractInlineTagsUtil(content))];
    } else {
      values = Array.isArray(fm.categories) ? fm.categories : (fm.categories ? [fm.categories] : []);
    }
    if (values.some(v => String(v).toLowerCase() === target)) {
      hits.push(path.relative(WORKSPACE, file));
    }
  }
  return hits;
}

function json(value: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Help content
// ---------------------------------------------------------------------------
const HELP_GUIDE = `# MarkGarden — AI Guide

MarkGarden turns any VS Code workspace into an Obsidian-style digital garden /
personal knowledge management (PKM) system over plain Markdown notes.

## Available MCP Vault Tools:
- markgarden_help        : Full usage guide for every MarkGarden feature/command
- list_notes             : All markdown notes with title, aliases, tags, categories, words
- get_note               : Full content + metadata of a specific note
- list_tags              : All tags (frontmatter + inline) with note counts
- list_categories        : All categories with note counts
- find_notes_by_tag      : Notes carrying a given tag
- find_notes_by_category : Notes carrying a given category
- search_notes           : Substring search across all notes with snippets
- get_backlinks          : Inbound links & unlinked mentions for a note
- get_outgoing_links     : Outbound wikilinks and transclusion embeds from a note
- get_vault_audit        : Digital garden audit report (growth stages, privacy leaks, broken links, orphans)
- create_note            : Create a note with YAML frontmatter
- append_daily_note      : Append a log entry, task, or thought to today's daily note
`;

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const server = new McpServer({ name: 'MarkGarden MCP', version: '1.1.0' });

server.registerTool('markgarden_help', {
  title: 'MarkGarden Help',
  description: 'Returns the full usage guide for MarkGarden features and MCP vault tools.',
  inputSchema: z.object({})
}, async () => ({ content: [{ type: 'text', text: HELP_GUIDE }] }));

server.registerTool('list_notes', {
  title: 'List Notes',
  description: 'List all Markdown notes in the workspace with title, aliases, tags, categories, and word count.',
  inputSchema: z.object({})
}, async () => {
  const notes = listNoteFiles().map(file => {
    const content = readNote(file);
    const fm = parseFrontmatterRecord(content);
    return {
      path: path.relative(WORKSPACE, file),
      title: fm.title || path.basename(file, '.md'),
      aliases: Array.isArray(fm.aliases) ? fm.aliases : [],
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      categories: Array.isArray(fm.categories) ? fm.categories : [],
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
    return { isError: true, content: [{ type: 'text' as const, text: 'Path escapes the workspace.' }] };
  }
  const content = readNote(abs);
  if (!content && !fs.existsSync(abs)) {
    return { isError: true, content: [{ type: 'text' as const, text: `Note not found: ${rel}` }] };
  }
  return { content: [{ type: 'text' as const, text: content }] };
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
  const hits: Array<{ path: string; snippet: string }> = [];
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

server.registerTool('get_outgoing_links', {
  title: 'Get Outgoing Links',
  description: 'Return all outbound wikilinks and transclusion embeds from a given note.',
  inputSchema: { path: z.string().describe('Workspace-relative path of the note, e.g. "notes/idea.md"') }
}, async ({ path: rel }) => {
  const abs = path.resolve(WORKSPACE, rel);
  const content = readNote(abs);
  if (!content && !fs.existsSync(abs)) {
    return { isError: true, content: [{ type: 'text' as const, text: `Note not found: ${rel}` }] };
  }
  const links = extractWikilinksUtil(content);
  return json({ path: rel, count: links.length, links });
});

server.registerTool('get_backlinks', {
  title: 'Get Backlinks',
  description: 'Return all notes linking to the target note, along with line snippets and unlinked mentions.',
  inputSchema: {
    note: z.string().describe('Target note title or filename (without .md)')
  }
}, async ({ note: targetName }) => {
  const targetLower = targetName.toLowerCase();
  const allFiles = listNoteFiles();
  const backlinks: Array<{ source: string; line: number; text: string; isEmbed: boolean }> = [];
  const unlinkedMentions: Array<{ source: string; line: number; text: string }> = [];

  for (const file of allFiles) {
    const rel = path.relative(WORKSPACE, file);
    const content = readNote(file);
    const lines = content.split(/\r?\n/);
    const outLinks = extractWikilinksUtil(content);

    for (const link of outLinks) {
      if (link.targetNote.toLowerCase() === targetLower) {
        const lineNum = link.line ?? 0;
        backlinks.push({
          source: rel,
          line: lineNum + 1,
          text: lines[lineNum] || link.raw,
          isEmbed: Boolean(link.isEmbed)
        });
      }
    }

    // Scan for unlinked mentions
    const mentionRegex = new RegExp(`\\b${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (lineText.includes('[[') && lineText.toLowerCase().includes(targetLower)) continue;
      if (mentionRegex.test(lineText)) {
        unlinkedMentions.push({
          source: rel,
          line: i + 1,
          text: lineText.trim()
        });
      }
    }
  }

  return json({
    target: targetName,
    backlinkCount: backlinks.length,
    backlinks,
    unlinkedMentionCount: unlinkedMentions.length,
    unlinkedMentions
  });
});

server.registerTool('get_vault_audit', {
  title: 'Get Vault Audit',
  description: 'Run an audit across the knowledge vault returning health score, growth breakdown, orphan notes, and broken links.',
  inputSchema: z.object({})
}, async () => {
  const allFiles = listNoteFiles();
  const noteSet = new Set<string>();
  const noteMap = new Map<string, { title: string; tags: string[]; categories: string[]; growth: string; published: boolean; links: any[] }>();

  for (const file of allFiles) {
    const rel = path.relative(WORKSPACE, file);
    const base = path.basename(file, '.md').toLowerCase();
    noteSet.add(base);
    noteSet.add(rel.toLowerCase());

    const content = readNote(file);
    const fm = parseFrontmatterRecord(content);
    const tags = Array.isArray(fm.tags) ? fm.tags : [];
    const growth = fm.growth || fm.stage || (tags.includes('evergreen') ? 'evergreen' : tags.includes('budding') ? 'budding' : 'seedling');
    const published = Boolean(fm.publish_external || fm.publish || tags.includes('published'));
    noteMap.set(rel, {
      title: fm.title || path.basename(file, '.md'),
      tags,
      categories: Array.isArray(fm.categories) ? fm.categories : [],
      growth,
      published,
      links: extractWikilinksUtil(content)
    });
  }

  const incomingCounts = new Map<string, number>();
  for (const rel of noteMap.keys()) incomingCounts.set(rel, 0);

  const brokenLinks: Array<{ source: string; target: string }> = [];

  for (const [rel, note] of noteMap.entries()) {
    for (const link of note.links) {
      const tgt = link.targetNote.toLowerCase();
      let found = false;
      for (const candidate of noteMap.keys()) {
        const candidateBase = path.basename(candidate, '.md').toLowerCase();
        if (candidateBase === tgt || candidate.toLowerCase() === tgt || candidate.toLowerCase() === `${tgt}.md`) {
          found = true;
          incomingCounts.set(candidate, (incomingCounts.get(candidate) || 0) + 1);
          break;
        }
      }
      if (!found) {
        brokenLinks.push({ source: rel, target: link.targetNote });
      }
    }
  }

  const orphans: string[] = [];
  for (const [rel, note] of noteMap.entries()) {
    const inc = incomingCounts.get(rel) || 0;
    if (inc === 0 && note.links.length === 0) {
      orphans.push(rel);
    }
  }

  const healthScore = Math.max(0, 100 - brokenLinks.length * 5 - orphans.length * 2);

  return json({
    totalNotes: allFiles.length,
    healthScore,
    orphanCount: orphans.length,
    orphans,
    brokenLinkCount: brokenLinks.length,
    brokenLinks
  });
});

server.registerTool('create_note', {
  title: 'Create Note',
  description: 'Create a new markdown note in the workspace with structured YAML frontmatter.',
  inputSchema: {
    path: z.string().describe('Relative file path for the new note, e.g. "concepts/reactivity.md"'),
    title: z.string().optional().describe('Note title'),
    tags: z.array(z.string()).optional().describe('Tags to assign'),
    categories: z.array(z.string()).optional().describe('Categories to assign'),
    content: z.string().optional().describe('Initial markdown body')
  }
}, async ({ path: rel, title, tags, categories, content: body }) => {
  const abs = path.resolve(WORKSPACE, rel.endsWith('.md') ? rel : `${rel}.md`);
  if (!abs.startsWith(path.resolve(WORKSPACE))) {
    return { isError: true, content: [{ type: 'text' as const, text: 'Path escapes workspace.' }] };
  }
  if (fs.existsSync(abs)) {
    return { isError: true, content: [{ type: 'text' as const, text: `Note already exists at ${rel}` }] };
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const noteTitle = title || path.basename(abs, '.md');
  const fm = [
    '---',
    `title: "${noteTitle}"`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    tags && tags.length > 0 ? `tags:\n${tags.map(t => `  - ${stripQuotes(t)}`).join('\n')}` : null,
    categories && categories.length > 0 ? `categories:\n${categories.map(c => `  - ${stripQuotes(c)}`).join('\n')}` : null,
    '---',
    '',
    `# ${noteTitle}`,
    '',
    body || ''
  ].filter(line => line !== null).join('\n');

  fs.writeFileSync(abs, fm, 'utf8');
  return json({ success: true, path: path.relative(WORKSPACE, abs), message: `Created note "${noteTitle}"` });
});

server.registerTool('append_daily_note', {
  title: 'Append Daily Note',
  description: 'Append an entry or bullet point to today\'s daily note (creating it if needed).',
  inputSchema: {
    text: z.string().describe('Markdown text or checklist item to append'),
    dailyNotesFolder: z.string().optional().describe('Subfolder for daily notes (defaults to root or "journal")')
  }
}, async ({ text, dailyNotesFolder }) => {
  const today = new Date().toISOString().slice(0, 10);
  const folder = dailyNotesFolder || '';
  const dir = path.resolve(WORKSPACE, folder);
  fs.mkdirSync(dir, { recursive: true });

  const notePath = path.join(dir, `${today}.md`);
  const exists = fs.existsSync(notePath);
  let content = '';

  if (exists) {
    content = fs.readFileSync(notePath, 'utf8');
    content += `\n\n${text.trim()}`;
  } else {
    content = `---\ntitle: "${today}"\ndate: ${today}\ntags:\n  - daily\n---\n\n# Daily Note - ${today}\n\n${text.trim()}`;
  }

  fs.writeFileSync(notePath, content, 'utf8');
  return json({ success: true, file: path.relative(WORKSPACE, notePath), message: `Appended to daily note ${today}` });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('[markgarden-mcp] fatal:', err.message);
  process.exit(1);
});
