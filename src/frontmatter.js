const vscode = require('vscode');
const path = require('path');
const { formatDateTime } = require('./templates');
const { extractInlineTags, extractHeadings, findPrimaryDocHeading } = require('./indexer');

/**
 * Standard Obsidian built-in property keys and descriptions for IntelliSense.
 */
const BUILTIN_PROPERTIES = [
  { key: 'title', description: 'The title of the note', snippet: 'title: "${1:Title}"' },
  { key: 'date', description: 'Date the note was created (YYYY-MM-DD or ISO)', snippet: 'date: ${1:YYYY-MM-DD}' },
  { key: 'updated', description: 'Last modified date/time (auto-updated on save)', snippet: 'updated: ${1:YYYY-MM-DD HH:mm:ss}' },
  { key: 'modified', description: 'Last modified date/time', snippet: 'modified: ${1:YYYY-MM-DD HH:mm:ss}' },
  { key: 'tags', description: 'List of tags for categorization', snippet: 'tags:\n  - ${1:tag}' },
  { key: 'categories', description: 'List of categories/topics', snippet: 'categories:\n  - ${1:category}' },
  { key: 'aliases', description: 'Alternative names and search aliases for wikilinks', snippet: 'aliases:\n  - ${1:alias}' },
  { key: 'description', description: 'Page description / summary for SEO & preview popovers', snippet: 'description: "${1:Description}"' },
  { key: 'author', description: 'Author of the note or content', snippet: 'author: "${1:Author}"' },
  { key: 'status', description: 'Status of the note (e.g. draft, in-progress, completed)', snippet: 'status: ${1|draft,in-progress,completed,archived|}' },
  { key: 'summary', description: 'Brief summary or TL;DR of note content', snippet: 'summary: "${1:Summary}"' },
  { key: 'draft', description: 'Whether the note is a draft (true/false)', snippet: 'draft: ${1|true,false|}' },
  { key: 'publish', description: 'Whether to publish this note (true/false)', snippet: 'publish: ${1|true,false|}' },
  { key: 'rating', description: 'Score or rating (e.g. 1-5 or 1-10)', snippet: 'rating: ${1:4.0}' },
  { key: 'year', description: 'Year of release or publication', snippet: 'year: ${1:2026}' },
  { key: 'source', description: 'URL, citation, or wikilink source reference', snippet: 'source: "${1:Source}"' },
  { key: 'url', description: 'Primary URL or external link', snippet: 'url: "${1:https://}"' },
  { key: 'letterboxd_uri', description: 'Letterboxd film URI', snippet: 'letterboxd_uri: "${1:https://boxd.it/}"' },
  { key: 'banner', description: 'URL or link to banner image', snippet: 'banner: "${1:banner.png}"' },
  { key: 'created', description: 'Creation timestamp', snippet: 'created: ${1:YYYY-MM-DD HH:mm:ss}' },
  { key: 'up', description: 'Link to parent or higher-level index note', snippet: 'up: "[[${1:Index Note}]]"' },
  { key: 'related', description: 'List of related notes', snippet: 'related:\n  - "[[${1:Related Note}]]"' },
  { key: 'type', description: 'Type or classification of note (e.g. concept, person, project)', snippet: 'type: ${1|concept,person,project,meeting,reference|}' }
];

/**
 * Returns frontmatter boundary information from a document or text string.
 */
function getFrontmatterInfo(content) {
  const result = {
    exists: false,
    startLine: -1,
    endLine: -1,
    rawYaml: '',
    yamlLines: [],
    bodyStartIndex: 0
  };

  if (!content) return result;

  // Check for initial '---'
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return result;

  result.exists = true;
  result.rawYaml = match[1];
  result.yamlLines = match[1].split(/\r?\n/);
  result.startLine = 0;
  result.endLine = result.yamlLines.length + 1; // 0-indexed line of closing '---'
  result.bodyStartIndex = match[0].length;

  return result;
}

/**
 * Checks if a given 0-indexed line number is inside the frontmatter block.
 */
function isLineInsideFrontmatter(content, lineIndex) {
  const info = getFrontmatterInfo(content);
  if (!info.exists) return false;
  return lineIndex >= info.startLine && lineIndex <= info.endLine;
}

/**
 * Parses frontmatter YAML block into key -> value representation.
 */
function parseFrontmatterLines(yamlLines) {
  const properties = new Map();
  let currentKey = null;

  for (let i = 0; i < yamlLines.length; i++) {
    const rawLine = yamlLines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('-') && currentKey) {
      const itemVal = trimmed.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      if (itemVal) {
        const existing = properties.get(currentKey);
        if (Array.isArray(existing)) {
          existing.push(itemVal);
        } else if (typeof existing === 'string' && existing.length > 0) {
          properties.set(currentKey, [existing, itemVal]);
        } else {
          properties.set(currentKey, [itemVal]);
        }
      }
      continue;
    }

    const colonIdx = rawLine.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = rawLine.slice(0, colonIdx).trim();
    const val = rawLine.slice(colonIdx + 1).trim();
    if (!rawKey) continue;

    currentKey = rawKey;

    if (val.startsWith('[') && val.endsWith(']')) {
      const items = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      properties.set(rawKey, items);
    } else if (val) {
      properties.set(rawKey, val.replace(/^['"]|['"]$/g, ''));
    } else {
      properties.set(rawKey, []);
    }
  }

  return properties;
}

/**
 * Formats a frontmatter property key-value pair as clean YAML string.
 */
function formatPropertyYaml(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${key}: []`;
    }
    const listItems = value.map(v => {
      const strVal = String(v).trim();
      if (strVal.includes('[[') || strVal.includes(':') || strVal.includes('#') || strVal.includes('"')) {
        return `  - "${strVal.replace(/"/g, '\\"')}"`;
      }
      return `  - ${strVal}`;
    }).join('\n');
    return `${key}:\n${listItems}`;
  }

  const strVal = String(value !== undefined && value !== null ? value : '').trim();
  if (strVal === '') {
    return `${key}:`;
  }
  if (strVal.includes('[[') || strVal.includes(':') || strVal.includes('"') || strVal.startsWith('#')) {
    return `${key}: "${strVal.replace(/"/g, '\\"')}"`;
  }
  return `${key}: ${strVal}`;
}

/**
 * Cleanly formats the entire frontmatter YAML block of a markdown string.
 */
function formatFrontmatterInMarkdown(content) {
  const info = getFrontmatterInfo(content);
  if (!info.exists) return content;

  const properties = parseFrontmatterLines(info.yamlLines);
  const formattedLines = [];

  // Preferred key ordering
  const keyOrder = ['title', 'date', 'created', 'updated', 'modified', 'author', 'tags', 'categories', 'aliases', 'status', 'summary'];
  const handledKeys = new Set();

  for (const preferred of keyOrder) {
    for (const [key, val] of properties.entries()) {
      if (key.toLowerCase() === preferred && !handledKeys.has(key.toLowerCase())) {
        formattedLines.push(formatPropertyYaml(key, val));
        handledKeys.add(key.toLowerCase());
      }
    }
  }

  // Remaining keys
  for (const [key, val] of properties.entries()) {
    if (!handledKeys.has(key.toLowerCase())) {
      formattedLines.push(formatPropertyYaml(key, val));
      handledKeys.add(key.toLowerCase());
    }
  }

  const newFrontmatter = `---\n${formattedLines.join('\n')}\n---`;
  const body = content.slice(info.bodyStartIndex);
  return `${newFrontmatter}${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/**
 * Adds or updates a property in a markdown string.
 */
function setPropertyInMarkdown(content, key, value) {
  const info = getFrontmatterInfo(content);
  const cleanKey = key.trim();

  if (!info.exists) {
    const formatted = formatPropertyYaml(cleanKey, value);
    const trimmedBody = content.trimStart();
    return `---\n${formatted}\n---\n\n${trimmedBody}`;
  }

  const properties = parseFrontmatterLines(info.yamlLines);
  
  // Find if key exists (case-insensitive)
  let foundOriginalKey = cleanKey;
  for (const existingKey of properties.keys()) {
    if (existingKey.toLowerCase() === cleanKey.toLowerCase()) {
      foundOriginalKey = existingKey;
      break;
    }
  }

  properties.set(foundOriginalKey, value);

  const formattedLines = [];
  for (const [k, v] of properties.entries()) {
    formattedLines.push(formatPropertyYaml(k, v));
  }

  const newFrontmatter = `---\n${formattedLines.join('\n')}\n---`;
  const body = content.slice(info.bodyStartIndex);
  return `${newFrontmatter}${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/**
 * Removes a property from a markdown string.
 */
function removePropertyFromMarkdown(content, key) {
  const info = getFrontmatterInfo(content);
  if (!info.exists) return content;

  const properties = parseFrontmatterLines(info.yamlLines);
  const cleanKey = key.trim().toLowerCase();

  let modified = false;
  for (const existingKey of properties.keys()) {
    if (existingKey.toLowerCase() === cleanKey) {
      properties.delete(existingKey);
      modified = true;
    }
  }

  if (!modified) return content;

  const formattedLines = [];
  for (const [k, v] of properties.entries()) {
    formattedLines.push(formatPropertyYaml(k, v));
  }

  const newFrontmatter = formattedLines.length > 0 ? `---\n${formattedLines.join('\n')}\n---` : '';
  const body = content.slice(info.bodyStartIndex);
  if (!newFrontmatter) {
    return body.trimStart();
  }
  return `${newFrontmatter}${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/**
 * Renames a property key in a markdown string across frontmatter.
 */
function renamePropertyInMarkdown(content, oldKey, newKey) {
  const info = getFrontmatterInfo(content);
  if (!info.exists) return content;

  const cleanOld = oldKey.trim().toLowerCase();
  const cleanNew = newKey.trim();
  const properties = parseFrontmatterLines(info.yamlLines);

  let modified = false;
  const newProperties = new Map();

  for (const [k, v] of properties.entries()) {
    if (k.toLowerCase() === cleanOld) {
      newProperties.set(cleanNew, v);
      modified = true;
    } else {
      newProperties.set(k, v);
    }
  }

  if (!modified) return content;

  const formattedLines = [];
  for (const [k, v] of newProperties.entries()) {
    formattedLines.push(formatPropertyYaml(k, v));
  }

  const newFrontmatter = `---\n${formattedLines.join('\n')}\n---`;
  const body = content.slice(info.bodyStartIndex);
  return `${newFrontmatter}${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/**
 * Extracts inline #tags from document body and merges them into frontmatter tags:.
 */
function convertInlineTagsToFrontmatterInMarkdown(content, removeInline = false) {
  const inlineTags = extractInlineTags(content);
  if (inlineTags.size === 0) return { content, count: 0 };

  const info = getFrontmatterInfo(content);
  const properties = info.exists ? parseFrontmatterLines(info.yamlLines) : new Map();

  // Find existing tags key
  let tagsKey = 'tags';
  for (const k of properties.keys()) {
    if (k.toLowerCase() === 'tags' || k.toLowerCase() === 'tag') {
      tagsKey = k;
      break;
    }
  }

  const existingTags = properties.get(tagsKey);
  const tagList = Array.isArray(existingTags) ? [...existingTags] : (typeof existingTags === 'string' && existingTags ? [existingTags] : []);

  let addedCount = 0;
  for (const tag of inlineTags) {
    if (!tagList.includes(tag)) {
      tagList.push(tag);
      addedCount++;
    }
  }

  properties.set(tagsKey, tagList);

  let body = info.exists ? content.slice(info.bodyStartIndex) : content;

  if (removeInline) {
    // Remove inline #tags from body while leaving headings intact
    body = body.replace(/(^|[ \t])#([a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*(?:\/[a-zA-Z0-9_\-\u0080-\uFFFF]+)*)/g, (match, prefix, tag) => {
      return `${prefix}${tag}`;
    });
  }

  const formattedLines = [];
  for (const [k, v] of properties.entries()) {
    formattedLines.push(formatPropertyYaml(k, v));
  }

  const newFrontmatter = `---\n${formattedLines.join('\n')}\n---`;
  const updatedContent = `${newFrontmatter}${body.startsWith('\n') ? '' : '\n'}${body}`;
  return { content: updatedContent, count: addedCount };
}

/**
 * Updates the modified date in a markdown string if a modified key exists or is configured.
 */
function updateModifiedDateInMarkdown(content, targetKey = 'updated', dateFormat = 'YYYY-MM-DD HH:mm:ss') {
  const info = getFrontmatterInfo(content);
  if (!info.exists) return content;

  const now = new Date();
  const formattedDate = formatDateTime(now, dateFormat);

  const candidateKeys = [
    targetKey.toLowerCase(),
    'updated',
    'modified',
    'lastmod',
    'last_modified',
    'last-modified',
    'modified_time',
    'last edited time',
    'datemodified'
  ];

  const lines = content.split(/\r?\n/);
  let matchedLineIdx = -1;
  let matchedKey = targetKey;

  for (let i = 1; i < info.endLine && i < lines.length; i++) {
    const rawLine = lines[i];
    const colonIdx = rawLine.indexOf(':');
    if (colonIdx !== -1) {
      const key = rawLine.slice(0, colonIdx).trim().toLowerCase();
      if (candidateKeys.includes(key)) {
        matchedLineIdx = i;
        matchedKey = rawLine.slice(0, colonIdx).trim();
        break;
      }
    }
  }

  if (matchedLineIdx === -1) {
    return content;
  }

  lines[matchedLineIdx] = `${matchedKey}: ${formattedDate}`;
  return lines.join('\n');
}

/**
 * Context-aware CompletionItemProvider for YAML frontmatter.
 */
class FrontmatterCompletionProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideCompletionItems(document, position, _token, _context) {
    const config = vscode.workspace.getConfiguration('markgarden');
    const enabled = config.get('frontmatter.enableCompletions', true);
    if (!enabled) return null;

    const text = document.getText();
    const info = getFrontmatterInfo(text);

    // Only activate if cursor is strictly inside the frontmatter block
    if (!info.exists || position.line <= info.startLine || position.line >= info.endLine) {
      return null;
    }

    const currentLine = document.lineAt(position.line).text;
    const textBeforeCursor = currentLine.slice(0, position.character);
    const trimmedBefore = textBeforeCursor.trim();

    // 1. Wikilink completions inside frontmatter (e.g. "[[note")
    const wikilinkMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
    if (wikilinkMatch) {
      const query = wikilinkMatch[1].toLowerCase();
      const notes = this.indexer.getAllNotes();
      return notes
        .filter(n => !query || n.baseName.toLowerCase().includes(query) || (n.frontmatterTitle && n.frontmatterTitle.toLowerCase().includes(query)))
        .map(n => {
          const item = new vscode.CompletionItem(n.baseName, vscode.CompletionItemKind.Reference);
          item.insertText = `${n.baseName}]]`;
          item.detail = n.frontmatterTitle ? `Title: ${n.frontmatterTitle}` : `Note: ${n.relativePath}`;
          item.documentation = new vscode.MarkdownString(`Link to **${n.baseName}**\n\n*Path*: \`${n.relativePath}\``);
          return item;
        });
    }

    // 2. Tag completions under tags: or tag:
    const isTagContext = this._isKeyContext(document, position, ['tags', 'tag']);
    if (isTagContext) {
      const allTags = this.indexer.getAllTags();
      return allTags.map(t => {
        const item = new vscode.CompletionItem(t.tag, vscode.CompletionItemKind.Keyword);
        item.detail = `#${t.tag} (${t.count} notes)`;
        item.documentation = new vscode.MarkdownString(`Obsidian Tag: \`#${t.tag}\`\n\nUsed in ${t.count} note(s).`);
        return item;
      });
    }

    // 3. Category completions under categories: or category:
    const isCategoryContext = this._isKeyContext(document, position, ['categories', 'category']);
    if (isCategoryContext) {
      const allCategories = this.indexer.getAllCategories();
      return allCategories.map(c => {
        const item = new vscode.CompletionItem(c.category, vscode.CompletionItemKind.Folder);
        item.detail = `Category (${c.count} notes)`;
        item.documentation = new vscode.MarkdownString(`Obsidian Category: \`${c.category}\`\n\nUsed in ${c.count} note(s).`);
        return item;
      });
    }

    // 4. Date / Timestamp completions for date keys
    const isDateContext = this._isKeyContext(document, position, ['date', 'created', 'updated', 'modified', 'lastmod', 'last_modified', 'datemodified']);
    if (isDateContext) {
      const now = new Date();
      const todayStr = formatDateTime(now, 'YYYY-MM-DD');
      const nowStr = formatDateTime(now, 'YYYY-MM-DD HH:mm:ss');
      const isoStr = now.toISOString();

      const items = [
        { label: todayStr, detail: 'Current date (YYYY-MM-DD)', insert: todayStr },
        { label: nowStr, detail: 'Current timestamp (YYYY-MM-DD HH:mm:ss)', insert: nowStr },
        { label: isoStr, detail: 'ISO-8601 Timestamp', insert: isoStr }
      ];

      return items.map(d => {
        const item = new vscode.CompletionItem(d.label, vscode.CompletionItemKind.Value);
        item.detail = d.detail;
        item.insertText = d.insert;
        return item;
      });
    }

    // 5. Dynamic value completions for custom properties (e.g. status:, priority:, type:)
    const activeKey = this._getActiveKey(document, position);
    if (activeKey && textBeforeCursor.includes(':')) {
      const indexedValues = this.indexer.getPropertyValues(activeKey);
      if (indexedValues.length > 0) {
        return indexedValues.map(val => {
          const item = new vscode.CompletionItem(val, vscode.CompletionItemKind.EnumMember);
          item.detail = `Value used in workspace for "${activeKey}"`;
          return item;
        });
      }
    }

    // 6. Property Key completions (when at line start or before colon)
    if (!textBeforeCursor.includes(':') && !trimmedBefore.startsWith('-')) {
      const workspaceKeys = this.indexer.getAllPropertyKeys();
      const defaultProps = config.get('frontmatter.defaultProperties', []);
      const combinedKeys = new Set([...workspaceKeys, ...defaultProps]);

      const items = [];

      for (const prop of BUILTIN_PROPERTIES) {
        const item = new vscode.CompletionItem(prop.key, vscode.CompletionItemKind.Property);
        item.detail = `Frontmatter Property`;
        item.documentation = new vscode.MarkdownString(prop.description);
        item.insertText = new vscode.SnippetString(prop.snippet);
        items.push(item);
        combinedKeys.delete(prop.key);
      }

      for (const key of combinedKeys) {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
        item.detail = `Workspace Frontmatter Property`;
        item.insertText = new vscode.SnippetString(`${key}: \${1}`);
        items.push(item);
      }

      return items;
    }

    return null;
  }

  /**
   * Checks if current position is under one of the target keys (either on same line or list items below).
   */
  _isKeyContext(document, position, targetKeys) {
    const currentLine = document.lineAt(position.line).text;
    const colonIdx = currentLine.indexOf(':');

    if (colonIdx !== -1 && position.character > colonIdx) {
      const key = currentLine.slice(0, colonIdx).trim().toLowerCase();
      if (targetKeys.includes(key)) return true;
    }

    // Check if cursor is on a list item line (e.g. '  - item') and look upwards for parent key
    if (currentLine.trim().startsWith('-')) {
      for (let i = position.line - 1; i >= 1; i--) {
        const line = document.lineAt(i).text;
        const lineColon = line.indexOf(':');
        if (lineColon !== -1) {
          const parentKey = line.slice(0, lineColon).trim().toLowerCase();
          return targetKeys.includes(parentKey);
        }
      }
    }

    return false;
  }

  /**
   * Retrieves the active property key for the current line / list item.
   */
  _getActiveKey(document, position) {
    const currentLine = document.lineAt(position.line).text;
    const colonIdx = currentLine.indexOf(':');

    if (colonIdx !== -1) {
      return currentLine.slice(0, colonIdx).trim().toLowerCase();
    }

    if (currentLine.trim().startsWith('-')) {
      for (let i = position.line - 1; i >= 1; i--) {
        const line = document.lineAt(i).text;
        const lineColon = line.indexOf(':');
        if (lineColon !== -1) {
          return line.slice(0, lineColon).trim().toLowerCase();
        }
      }
    }

    return null;
  }
}

/**
 * Registers workspace save listener to automatically update modified date in frontmatter.
 */
function registerFrontmatterSaveHandler(context, _indexer) {
  const saveDisposable = vscode.workspace.onWillSaveTextDocument(event => {
    if (event.document.languageId !== 'markdown' || event.document.uri.scheme !== 'file') {
      return;
    }

    const config = vscode.workspace.getConfiguration('markgarden');
    const autoUpdate = config.get('frontmatter.autoUpdateModifiedDate', true);
    if (!autoUpdate) return;

    const modifiedKey = config.get('frontmatter.modifiedDateKey', 'updated');
    const dateFormat = config.get('frontmatter.dateFormat', 'YYYY-MM-DD HH:mm:ss');

    const content = event.document.getText();
    const updatedContent = updateModifiedDateInMarkdown(content, modifiedKey, dateFormat);

    if (updatedContent !== content) {
      const fullRange = new vscode.Range(
        event.document.positionAt(0),
        event.document.positionAt(content.length)
      );
      event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, updatedContent)]));
    }
  });

  context.subscriptions.push(saveDisposable);
}

/**
 * Command: Add or set a frontmatter property in the active note.
 */
async function addPropertyCommand(indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown file to add frontmatter properties.');
    return;
  }

  const workspaceKeys = indexer ? indexer.getAllPropertyKeys() : BUILTIN_PROPERTIES.map(p => p.key);
  const quickPickItems = [
    { label: '$(plus) Create new property...', key: '__new__' },
    ...workspaceKeys.map(k => {
      const builtin = BUILTIN_PROPERTIES.find(b => b.key === k);
      return {
        label: k,
        description: builtin ? builtin.description : 'Frontmatter property',
        key: k
      };
    })
  ];

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: 'Select a frontmatter property to add or update'
  });
  if (!selected) return;

  let propertyKey = selected.key;
  if (propertyKey === '__new__') {
    const inputKey = await vscode.window.showInputBox({
      prompt: 'Enter new frontmatter property key name (e.g. status, author, rating)',
      placeHolder: 'property_name',
      validateInput: val => {
        if (!val || !val.trim()) return 'Property name cannot be empty';
        if (val.includes(':') || val.includes('\n')) return 'Invalid property name';
        return null;
      }
    });
    if (!inputKey) return;
    propertyKey = inputKey.trim();
  }

  // Check if workspace has known values for this key
  const knownValues = indexer ? indexer.getPropertyValues(propertyKey) : [];
  let propertyValue = '';

  if (propertyKey === 'date' || propertyKey === 'created' || propertyKey === 'updated' || propertyKey === 'modified') {
    const now = new Date();
    propertyValue = formatDateTime(now, 'YYYY-MM-DD HH:mm:ss');
  } else if (knownValues.length > 0) {
    const valueOptions = [
      { label: '$(edit) Enter custom value...', value: '__custom__' },
      ...knownValues.map(v => ({ label: v, value: v }))
    ];
    const valSelected = await vscode.window.showQuickPick(valueOptions, {
      placeHolder: `Select or enter value for "${propertyKey}"`
    });
    if (!valSelected) return;
    if (valSelected.value === '__custom__') {
      const inputVal = await vscode.window.showInputBox({
        prompt: `Enter value for frontmatter property "${propertyKey}"`,
        placeHolder: 'value'
      });
      if (inputVal === undefined) return;
      propertyValue = inputVal;
    } else {
      propertyValue = valSelected.value;
    }
  } else {
    const inputVal = await vscode.window.showInputBox({
      prompt: `Enter value for frontmatter property "${propertyKey}"`,
      placeHolder: 'value'
    });
    if (inputVal === undefined) return;
    propertyValue = inputVal;
  }

  const document = editor.document;
  const content = document.getText();
  const updatedContent = setPropertyInMarkdown(content, propertyKey, propertyValue);

  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, updatedContent);
  });

  vscode.window.showInformationMessage(`MarkGarden: Property "${propertyKey}" set successfully.`);
}

/**
 * Command: Format and normalize frontmatter YAML in active note.
 */
async function formatFrontmatterCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown file to format frontmatter.');
    return;
  }

  const document = editor.document;
  const content = document.getText();
  const formatted = formatFrontmatterInMarkdown(content);

  if (formatted === content) {
    vscode.window.showInformationMessage('MarkGarden: Frontmatter is already cleanly formatted.');
    return;
  }

  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, formatted);
  });

  vscode.window.showInformationMessage('MarkGarden: Formatted frontmatter successfully.');
}

/**
 * Command: Rename a frontmatter property key across the entire workspace.
 */
async function renamePropertyWorkspaceCommand(indexer) {
  if (!indexer) {
    vscode.window.showErrorMessage('MarkGarden: Workspace indexer not available.');
    return;
  }

  const allKeys = indexer.getAllPropertyKeys();
  if (allKeys.length === 0) {
    vscode.window.showInformationMessage('MarkGarden: No frontmatter properties found in workspace.');
    return;
  }

  const selectedKey = await vscode.window.showQuickPick(
    allKeys.map(k => {
      const notes = indexer.getNotesWithProperty(k);
      return {
        label: k,
        description: `${notes.length} note(s)`,
        key: k
      };
    }),
    { placeHolder: 'Select a frontmatter property key to rename across workspace' }
  );
  if (!selectedKey) return;

  const newKey = await vscode.window.showInputBox({
    prompt: `Enter new name for property "${selectedKey.key}"`,
    value: selectedKey.key,
    validateInput: val => {
      if (!val || !val.trim()) return 'Property name cannot be empty';
      if (val.trim().toLowerCase() === selectedKey.key.toLowerCase()) return 'New name must be different from old name';
      if (val.includes(':') || val.includes('\n')) return 'Invalid property name';
      return null;
    }
  });
  if (!newKey) return;

  const targetNotes = indexer.getNotesWithProperty(selectedKey.key);
  if (targetNotes.length === 0) {
    vscode.window.showInformationMessage(`MarkGarden: No notes currently contain property "${selectedKey.key}".`);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Rename frontmatter property "${selectedKey.key}" to "${newKey.trim()}" across ${targetNotes.length} note(s)?`,
    { modal: true },
    'Rename'
  );
  if (confirm !== 'Rename') return;

  const workspaceEdit = new vscode.WorkspaceEdit();

  for (const filePath of targetNotes) {
    const uri = vscode.Uri.file(filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const updated = renamePropertyInMarkdown(text, selectedKey.key, newKey.trim());
      if (updated !== text) {
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
        workspaceEdit.replace(uri, fullRange, updated);
      }
    } catch {
      // Continue with other files if one fails
    }
  }

  await vscode.workspace.applyEdit(workspaceEdit);
  vscode.window.showInformationMessage(`MarkGarden: Renamed property "${selectedKey.key}" to "${newKey.trim()}" in ${targetNotes.length} note(s).`);
}

/**
 * Command: Convert inline #tags to frontmatter tags: list.
 */
async function convertInlineTagsToFrontmatterCommand(_indexer) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown file to convert tags.');
    return;
  }

  const document = editor.document;
  const content = document.getText();
  const inlineTags = extractInlineTags(content);

  if (inlineTags.size === 0) {
    vscode.window.showInformationMessage('MarkGarden: No inline #tags found in this note.');
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Copy inline tags to frontmatter', removeInline: false, description: 'Keeps #hashtags in body and adds to frontmatter' },
      { label: 'Move inline tags to frontmatter', removeInline: true, description: 'Strips # from hashtags in body and adds to frontmatter' }
    ],
    { placeHolder: `Found ${inlineTags.size} inline tag(s). Select conversion mode:` }
  );
  if (!action) return;

  const { content: updatedContent, count } = convertInlineTagsToFrontmatterInMarkdown(content, action.removeInline);

  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, updatedContent);
  });

  vscode.window.showInformationMessage(`MarkGarden: Added ${count} tag(s) to frontmatter.`);
}

/**
 * Command: Sync note title with filename or H1 heading.
 */
async function syncTitleWithFilenameCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown file to sync title.');
    return;
  }

  const document = editor.document;
  const filePath = document.fileName;
  const baseName = path.basename(filePath, '.md');
  const content = document.getText();

  const headings = extractHeadings(content);
  const primaryH1 = findPrimaryDocHeading(content, headings);
  const targetTitle = primaryH1 || baseName;

  const updatedContent = setPropertyInMarkdown(content, 'title', targetTitle);

  if (updatedContent === content) {
    vscode.window.showInformationMessage(`MarkGarden: Frontmatter title is already "${targetTitle}".`);
    return;
  }

  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
  await editor.edit(editBuilder => {
    editBuilder.replace(fullRange, updatedContent);
  });

  vscode.window.showInformationMessage(`MarkGarden: Synced frontmatter title to "${targetTitle}".`);
}

module.exports = {
  BUILTIN_PROPERTIES,
  getFrontmatterInfo,
  isLineInsideFrontmatter,
  parseFrontmatterLines,
  formatPropertyYaml,
  formatFrontmatterInMarkdown,
  setPropertyInMarkdown,
  removePropertyFromMarkdown,
  renamePropertyInMarkdown,
  convertInlineTagsToFrontmatterInMarkdown,
  updateModifiedDateInMarkdown,
  FrontmatterCompletionProvider,
  registerFrontmatterSaveHandler,
  addPropertyCommand,
  formatFrontmatterCommand,
  renamePropertyWorkspaceCommand,
  convertInlineTagsToFrontmatterCommand,
  syncTitleWithFilenameCommand
};
