/**
 * Pure parser utilities for MarkGarden with ZERO VS Code dependencies.
 * Shared across src/indexer.ts, src/mcpServer.ts, and external tools.
 */
import * as path from 'path';

export const MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico',
  'pdf',
  'mp3', 'wav', 'm4a', 'ogg', 'flac',
  'mp4', 'webm', 'mov', 'mkv', 'avi'
]);

/**
 * Strips surrounding single/double quotes from a value (if balanced).
 */
export function stripQuotes(value: string): string {
  if (!value) return '';
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Splits an inline YAML-style list into entries, respecting quoted strings
 * so values containing commas are not broken apart (e.g. `["a, b", c]`).
 */
export function splitInlineList(val: string): string[] {
  const entries: string[] = [];
  let current = '';
  let quoteChar: string | null = null;
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
    } else if (ch === ',') {
      entries.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  entries.push(current.trim());
  return entries.map(s => stripQuotes(s)).filter(Boolean);
}

/**
 * Parses an inline bracketed list value like [a, "b, c"] into string entries.
 */
export function parseInlineBracketList(val: string): string[] {
  const inner = val.slice(1, -1).trim();
  if (!inner) return [];
  return splitInlineList(inner);
}

/**
 * Parses a comma-separated scalar list like "a, b, c" (used for tags:, aliases:, etc.).
 * Quoted segments containing commas are preserved as one entry.
 */
export function parseCommaList(val: string): string[] {
  return splitInlineList(val.replace(/[[\]]/g, ''));
}

export interface FrontmatterRange {
  startLine: number;
  endLine: number;
}

export interface ParsedFrontmatter {
  title: string;
  tags: Set<string>;
  categories: Set<string>;
  aliases: Set<string>;
  properties: Map<string, any>;
  propertyKeys: Set<string>;
  hasFrontmatter: boolean;
  frontmatterRange: FrontmatterRange | null;
}

/**
 * Parses frontmatter YAML block from markdown content.
 * Returns an object with parsed properties (title, tags, categories, raw content).
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {
    title: '',
    tags: new Set<string>(),
    categories: new Set<string>(),
    aliases: new Set<string>(),
    properties: new Map<string, any>(),
    propertyKeys: new Set<string>(),
    hasFrontmatter: false,
    frontmatterRange: null
  };

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return result;
  }

  result.hasFrontmatter = true;
  const rawYaml = match[1];
  const lines = rawYaml.split(/\r?\n/);
  result.frontmatterRange = {
    startLine: 0,
    endLine: lines.length + 1
  };

  let currentKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check for list item under current key (e.g. "  - tag1")
    if (trimmed.startsWith('-') && currentKey) {
      const itemVal = stripQuotes(trimmed.replace(/^\s*-\s*/, '').trim());
      if (itemVal) {
        if (currentKey === 'tags' || currentKey === 'tag') {
          result.tags.add(itemVal);
        } else if (currentKey === 'categories' || currentKey === 'category') {
          result.categories.add(itemVal);
        } else if (currentKey === 'aliases' || currentKey === 'alias') {
          result.aliases.add(itemVal);
        }

        const existing = result.properties.get(currentKey);
        if (Array.isArray(existing)) {
          existing.push(itemVal);
        } else if (typeof existing === 'string' && existing.length > 0) {
          result.properties.set(currentKey, [existing, itemVal]);
        } else {
          result.properties.set(currentKey, [itemVal]);
        }
      }
      continue;
    }

    const colonIdx = rawLine.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }

    const rawKey = rawLine.slice(0, colonIdx).trim();
    const key = rawKey.toLowerCase();
    const val = rawLine.slice(colonIdx + 1).trim();

    if (!key) continue;

    currentKey = key;
    result.propertyKeys.add(rawKey);

    // Multiline block scalars (key: | / > / |- / >-) consume the following indented lines.
    if (/^[|>][+-]?$/.test(val)) {
      const blockLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const blockLine = lines[j];
        if (blockLine.trim() === '' || /^[ \t]/.test(blockLine)) {
          blockLines.push(blockLine.trim());
        } else {
          break;
        }
      }
      result.properties.set(key, blockLines.join('\n'));
      i = j - 1; // skip consumed lines on next loop iteration
      continue;
    }

    if (key === 'title') {
      const cleanVal = stripQuotes(val);
      result.title = cleanVal;
      result.properties.set(key, cleanVal);
    } else if (key === 'tags' || key === 'tag') {
      if (val) {
        const tagList = parseCommaList(val);
        tagList.forEach(t => result.tags.add(t));
        result.properties.set(key, tagList);
      } else {
        result.properties.set(key, []);
      }
    } else if (key === 'categories' || key === 'category') {
      if (val) {
        const catList = parseCommaList(val);
        catList.forEach(c => result.categories.add(c));
        result.properties.set(key, catList);
      } else {
        result.properties.set(key, []);
      }
    } else if (key === 'aliases' || key === 'alias') {
      if (val) {
        const aliasList = parseCommaList(val);
        aliasList.forEach(a => result.aliases.add(a));
        result.properties.set(key, aliasList);
      } else {
        result.properties.set(key, []);
      }
    } else {
      if (val) {
        if (val.startsWith('[') && val.endsWith(']')) {
          const listVals = parseInlineBracketList(val);
          result.properties.set(key, listVals);
        } else {
          result.properties.set(key, val.replace(/^['"]|['"]$/g, ''));
        }
      } else {
        result.properties.set(key, []);
      }
    }
  }

  return result;
}

/**
 * Checks if a target filename is an embedded image or media attachment.
 */
export function isMediaFile(filename: string): boolean {
  if (!filename) return false;
  const clean = filename.split('|')[0].trim().split('#')[0].trim();
  const ext = path.extname(clean).toLowerCase().replace(/^\./, '');
  return MEDIA_EXTENSIONS.has(ext);
}

export interface ParsedWikilink {
  raw: string;
  targetNote: string;
  heading: string;
  blockId: string;
  alias: string;
  isMedia: boolean;
  index?: number;
  line?: number;
  isEmbed?: boolean;
}

/**
 * Parses wikilink string (e.g. "Note Name#Section|Alias" or "Note#^block-id") into components.
 */
export function parseWikilinkTarget(rawLink: string): ParsedWikilink {
  let text = rawLink.trim();
  let alias = '';
  let heading = '';
  let blockId = '';
  let targetNote = '';

  const pipeIdx = text.indexOf('|');
  if (pipeIdx !== -1) {
    alias = text.slice(pipeIdx + 1).trim();
    text = text.slice(0, pipeIdx).trim();
  }

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
 * Masks frontmatter, fenced code blocks (``` / ~~~), and HTML comments with spaces
 * while preserving newlines, so character offsets and line numbers stay accurate.
 */
export function maskExcludedRegions(content: string): string {
  return content
    .replace(/^---\r?\n[\s\S]*?\r?\n---|```[\s\S]*?```|~~~[\s\S]*?~~~|<!--[\s\S]*?-->/g, m => m.replace(/[^\r\n]/g, ' '))
    .replace(/`[^`\r\n]+`/g, m => m.replace(/[^\r\n]/g, ' '));
}

/**
 * Sanitizes markdown content for inline tag extraction by replacing
 * code blocks, inline code, and URLs with whitespace preserving line numbers.
 */
export function sanitizeContentForTags(content: string): string {
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
export function extractInlineTags(content: string): Set<string> {
  const tags = new Set<string>();
  const sanitized = sanitizeContentForTags(content);

  // Match #tag where tag starts with a letter, underscore, or non-ASCII, followed by letters/digits/underscores/dashes/slashes
  // Cannot be purely numeric
  const tagRegex = /(?:^|\s)#([a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*(?:\/[a-zA-Z0-9_\-\u0080-\uFFFF]+)*)/g;
  let match: RegExpExecArray | null;
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
 * Extracts all outbound wikilinks and transclusion embeds from markdown content.
 */
export function extractWikilinks(content: string): ParsedWikilink[] {
  const sanitized = maskExcludedRegions(content);
  const links: ParsedWikilink[] = [];
  const regex = /(!?\[\[)([^[\r\n\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let currentLine = 0;

  while ((match = regex.exec(sanitized)) !== null) {
    const isEmbed = match[1] === '![[';
    const parsed = parseWikilinkTarget(match[2]);
    if (!parsed.isMedia) {
      const charIndex = match.index;
      for (let i = lastIndex; i < charIndex; i++) {
        if (content.charCodeAt(i) === 10) {
          currentLine++;
        }
      }
      lastIndex = charIndex;

      parsed.index = charIndex;
      parsed.line = currentLine;
      parsed.isEmbed = isEmbed;
      links.push(parsed);
    }
  }
  return links;
}
