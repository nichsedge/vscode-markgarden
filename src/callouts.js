const vscode = require('vscode');

/**
 * Standard Obsidian Callout Types and metadata (icon, color, display label).
 */
const OBSIDIAN_CALLOUT_TYPES = {
  note: { label: 'Note', icon: '📝', color: '#0284c7', vsCodeIcon: 'note' },
  abstract: { label: 'Abstract', icon: '📋', color: '#00b4d8', vsCodeIcon: 'book' },
  summary: { label: 'Summary', icon: '📋', color: '#00b4d8', vsCodeIcon: 'book' },
  tldr: { label: 'TL;DR', icon: '📋', color: '#00b4d8', vsCodeIcon: 'book' },
  info: { label: 'Info', icon: 'ℹ️', color: '#0284c7', vsCodeIcon: 'info' },
  todo: { label: 'Todo', icon: '☑️', color: '#0284c7', vsCodeIcon: 'checklist' },
  tip: { label: 'Tip', icon: '💡', color: '#10b981', vsCodeIcon: 'lightbulb' },
  hint: { label: 'Hint', icon: '💡', color: '#10b981', vsCodeIcon: 'lightbulb' },
  important: { label: 'Important', icon: '🔥', color: '#06b6d4', vsCodeIcon: 'flame' },
  success: { label: 'Success', icon: '✅', color: '#10b981', vsCodeIcon: 'check' },
  check: { label: 'Check', icon: '✅', color: '#10b981', vsCodeIcon: 'check' },
  done: { label: 'Done', icon: '✅', color: '#10b981', vsCodeIcon: 'check' },
  question: { label: 'Question', icon: '❓', color: '#f59e0b', vsCodeIcon: 'question' },
  help: { label: 'Help', icon: '❓', color: '#f59e0b', vsCodeIcon: 'question' },
  faq: { label: 'FAQ', icon: '❓', color: '#f59e0b', vsCodeIcon: 'question' },
  warning: { label: 'Warning', icon: '⚠️', color: '#f59e0b', vsCodeIcon: 'warning' },
  caution: { label: 'Caution', icon: '⚠️', color: '#f59e0b', vsCodeIcon: 'warning' },
  attention: { label: 'Attention', icon: '⚠️', color: '#f59e0b', vsCodeIcon: 'warning' },
  failure: { label: 'Failure', icon: '❌', color: '#ef4444', vsCodeIcon: 'error' },
  fail: { label: 'Fail', icon: '❌', color: '#ef4444', vsCodeIcon: 'error' },
  missing: { label: 'Missing', icon: '❌', color: '#ef4444', vsCodeIcon: 'error' },
  danger: { label: 'Danger', icon: '⚡', color: '#ef4444', vsCodeIcon: 'zap' },
  error: { label: 'Error', icon: '⚡', color: '#ef4444', vsCodeIcon: 'error' },
  bug: { label: 'Bug', icon: '🐛', color: '#ef4444', vsCodeIcon: 'bug' },
  example: { label: 'Example', icon: '🔍', color: '#8b5cf6', vsCodeIcon: 'search' },
  quote: { label: 'Quote', icon: '💬', color: '#94a3b8', vsCodeIcon: 'quote' },
  cite: { label: 'Cite', icon: '💬', color: '#94a3b8', vsCodeIcon: 'quote' }
};

/**
 * Regex for matching Obsidian callout header line.
 * Matches: `> [!type]+ Custom Title` or `> [!type]-` or `> [!type]`
 */
const CALLOUT_HEADER_REGEX = /^>\s*\[!([a-zA-Z_-]+)\]([+-])?(?:\s+(.*))?$/;

/**
 * Parses a line to check if it's an Obsidian callout header.
 * @param {string} line 
 * @returns {{ isCallout: boolean, type: string, fold: string|null, title: string, meta: object } | null}
 */
function parseCalloutHeader(line) {
  if (!line || typeof line !== 'string') return null;
  const match = line.trim().match(CALLOUT_HEADER_REGEX);
  if (!match) return null;

  const rawType = match[1].toLowerCase();
  const fold = match[2] || null; // '+' for expanded, '-' for collapsed
  const title = match[3] ? match[3].trim() : '';

  return {
    isCallout: true,
    type: rawType,
    fold,
    title,
    meta: OBSIDIAN_CALLOUT_TYPES[rawType] || {
      label: rawType.charAt(0).toUpperCase() + rawType.slice(1),
      icon: '📌',
      color: '#6366f1',
      vsCodeIcon: 'symbol-misc'
    }
  };
}

/**
 * Wraps text into an Obsidian callout block.
 * @param {string} content - Selected text or empty
 * @param {string} type - Callout type (e.g. 'note', 'tip')
 * @param {string} title - Optional custom title
 * @param {string|null} fold - '+' or '-' or null
 * @returns {string} Formatted callout markdown
 */
function formatCalloutBlock(content, type = 'note', title = '', fold = null) {
  const foldMarker = fold ? fold : '';
  const titlePart = title ? ` ${title}` : '';
  const headerLine = `> [!${type}]${foldMarker}${titlePart}`;

  if (!content || !content.trim()) {
    return `${headerLine}\n> `;
  }

  const lines = content.split(/\r?\n/);
  const bodyLines = lines.map(line => `> ${line}`);
  return `${headerLine}\n${bodyLines.join('\n')}\n`;
}

/**
 * Command to insert an Obsidian Callout at the cursor or around current selection.
 */
async function insertCalloutCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('MarkGarden: Please open a Markdown file to insert a callout.');
    return;
  }

  // Build QuickPick items from supported types
  const pickItems = Object.entries(OBSIDIAN_CALLOUT_TYPES).map(([typeKey, info]) => ({
    label: `${info.icon} [!${typeKey}]`,
    description: info.label,
    calloutType: typeKey
  }));

  const selectedType = await vscode.window.showQuickPick(pickItems, {
    placeHolder: 'Select Obsidian Callout Type'
  });

  if (!selectedType) return;

  // Ask for optional custom title
  const title = await vscode.window.showInputBox({
    prompt: 'Custom title for callout (leave empty for default title)',
    placeHolder: selectedType.description
  });

  if (title === undefined) return; // User cancelled

  // Ask for foldability
  const foldOption = await vscode.window.showQuickPick([
    { label: 'Normal (Non-collapsible)', fold: null },
    { label: 'Collapsible (Expanded by default [+])', fold: '+' },
    { label: 'Collapsible (Collapsed by default [-])', fold: '-' }
  ], {
    placeHolder: 'Callout Foldability'
  });

  if (!foldOption) return;

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  const formattedCallout = formatCalloutBlock(
    selectedText,
    selectedType.calloutType,
    title.trim(),
    foldOption.fold
  );

  await editor.edit(editBuilder => {
    if (selection.isEmpty) {
      editBuilder.insert(selection.active, formattedCallout);
    } else {
      editBuilder.replace(selection, formattedCallout);
    }
  });

  // If selection was empty, position cursor on the empty body line
  if (selection.isEmpty) {
    const newPos = new vscode.Position(selection.active.line + 1, 2);
    editor.selection = new vscode.Selection(newPos, newPos);
  }
}

/**
 * Editor Decorator for Obsidian Callouts.
 * Adds visual accent line and icon decoration to callout headers in the active editor.
 */
class CalloutEditorDecorator {
  constructor() {
    this.decorationTypes = new Map();
    this.timeout = null;
  }

  getDecorationTypeForColor(color) {
    if (!this.decorationTypes.has(color)) {
      const decType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane ? vscode.OverviewRulerLane.Left : 1,
        light: {
          backgroundColor: `${color}10`,
          border: `1px solid ${color}40`,
          borderRadius: '4px'
        },
        dark: {
          backgroundColor: `${color}18`,
          border: `1px solid ${color}40`,
          borderRadius: '4px'
        }
      });
      this.decorationTypes.set(color, decType);
    }
    return this.decorationTypes.get(color);
  }

  updateDecorations(editor) {
    if (!editor || !editor.document || editor.document.languageId !== 'markdown') return;

    const config = vscode.workspace.getConfiguration('markgarden');
    const enabled = config.get('callouts.enableDecorations', true);
    if (!enabled) {
      this.clear(editor);
      return;
    }

    const colorRangesMap = new Map();
    const doc = editor.document;
    const lineCount = doc.lineCount;

    for (let i = 0; i < lineCount; i++) {
      const line = doc.lineAt(i);
      const parsed = parseCalloutHeader(line.text);
      if (parsed) {
        const color = parsed.meta.color;
        if (!colorRangesMap.has(color)) {
          colorRangesMap.set(color, []);
        }
        colorRangesMap.get(color).push(line.range);
      }
    }

    // Apply ranges for all active colors
    for (const [color, decType] of this.decorationTypes.entries()) {
      const ranges = colorRangesMap.get(color) || [];
      editor.setDecorations(decType, ranges);
    }

    for (const [color, ranges] of colorRangesMap.entries()) {
      const decType = this.getDecorationTypeForColor(color);
      editor.setDecorations(decType, ranges);
    }
  }

  triggerUpdate(editor, delay = 100) {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      this.updateDecorations(editor);
    }, delay);
  }

  clear(editor) {
    if (!editor) return;
    for (const decType of this.decorationTypes.values()) {
      editor.setDecorations(decType, []);
    }
  }

  dispose() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    for (const decType of this.decorationTypes.values()) {
      decType.dispose();
    }
    this.decorationTypes.clear();
  }
}

/**
 * Markdown-it plugin function for rendering Obsidian Callouts into styled HTML.
 * @param {object} md - markdown-it instance
 */
function markdownItCalloutsPlugin(md) {
  if (!md) return;

  const hasRenderer = md.renderer && md.renderer.rules;
  const originalBlockquoteRender = hasRenderer && md.renderer.rules.blockquote_open
    ? md.renderer.rules.blockquote_open
    : function(tokens, idx, options, env, self) {
        return self && self.renderToken ? self.renderToken(tokens, idx, options) : '';
      };

  // Enhance blockquote rendering for Obsidian callouts
  if (md.core && md.core.ruler) {
    md.core.ruler.after('block', 'obsidian_callouts', function(state) {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'blockquote_open') {
        // Look inside the blockquote for the first inline token
        let calloutHeader = null;
        let inlineTokenIdx = -1;

        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'blockquote_close') break;
          if (tokens[j].type === 'inline' && tokens[j].content) {
            const firstLine = tokens[j].content.split(/\r?\n/)[0];
            const parsed = parseCalloutHeader(`> ${firstLine}`);
            if (parsed) {
              calloutHeader = parsed;
              inlineTokenIdx = j;
            }
            break;
          }
        }

        if (calloutHeader && inlineTokenIdx !== -1) {
          const type = calloutHeader.type;
          const meta = calloutHeader.meta;
          const displayTitle = calloutHeader.title || meta.label;
          const fold = calloutHeader.fold;

          // Strip header text from first inline token
          const inlineTok = tokens[inlineTokenIdx];
          const lines = inlineTok.content.split(/\r?\n/);
          lines.shift(); // remove `[!type] title` line
          inlineTok.content = lines.join('\n');

          // If child text tokens exist, clean up first child
          if (inlineTok.children && inlineTok.children.length > 0) {
            const matchHeaderRegex = /^\[!([a-zA-Z_-]+)\]([+-])?(?:\s+(.*))?$/;
            for (let c = 0; c < inlineTok.children.length; c++) {
              if (inlineTok.children[c].type === 'text') {
                if (matchHeaderRegex.test(inlineTok.children[c].content.trim())) {
                  inlineTok.children[c].content = '';
                  break;
                }
              }
            }
          }

          // Mark the blockquote token with callout metadata
          tokens[i].callout = {
            type,
            meta,
            displayTitle,
            fold
          };
        }
      }
    }
  });
  }

  if (hasRenderer) {
    // Override blockquote open/close renderers
    md.renderer.rules.blockquote_open = function(tokens, idx, options, env, self) {
      const token = tokens[idx];
      if (token.callout) {
        const { type, meta, displayTitle, fold } = token.callout;
        const color = meta.color;
        const icon = meta.icon;

        if (fold) {
          const isOpen = fold === '+' ? ' open' : '';
          return `<details class="obsidian-callout callout-${type}" style="border-left: 4px solid ${color}; background-color: ${color}14; padding: 10px 14px; margin: 12px 0; border-radius: 4px;"${isOpen}>\n<summary style="font-weight: 600; cursor: pointer; color: ${color}; list-style: none; display: flex; align-items: center; gap: 8px;">\n<span class="callout-icon">${icon}</span>\n<span class="callout-title">${md.utils && md.utils.escapeHtml ? md.utils.escapeHtml(displayTitle) : displayTitle}</span>\n</summary>\n<div class="callout-content" style="margin-top: 8px;">`;
        }

        return `<div class="obsidian-callout callout-${type}" style="border-left: 4px solid ${color}; background-color: ${color}14; padding: 10px 14px; margin: 12px 0; border-radius: 4px;">\n<div class="callout-title-bar" style="font-weight: 600; color: ${color}; display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">\n<span class="callout-icon">${icon}</span>\n<span class="callout-title">${md.utils && md.utils.escapeHtml ? md.utils.escapeHtml(displayTitle) : displayTitle}</span>\n</div>\n<div class="callout-content">`;
      }

      return originalBlockquoteRender(tokens, idx, options, env, self);
    };

    const originalBlockquoteClose = md.renderer.rules.blockquote_close || function(tokens, idx, options, env, self) {
      return self && self.renderToken ? self.renderToken(tokens, idx, options) : '';
    };

    md.renderer.rules.blockquote_close = function(tokens, idx, options, env, self) {
      // Find matching open token
      let count = 0;
      for (let j = idx - 1; j >= 0; j--) {
        if (tokens[j].type === 'blockquote_close') count++;
        if (tokens[j].type === 'blockquote_open') {
          if (count === 0) {
            if (tokens[j].callout) {
              if (tokens[j].callout.fold) {
                return `</div></details>`;
              }
              return `</div></div>`;
            }
            break;
          }
          count--;
        }
      }
      return originalBlockquoteClose(tokens, idx, options, env, self);
    };
  }
}

module.exports = {
  OBSIDIAN_CALLOUT_TYPES,
  CALLOUT_HEADER_REGEX,
  parseCalloutHeader,
  formatCalloutBlock,
  insertCalloutCommand,
  CalloutEditorDecorator,
  markdownItCalloutsPlugin
};
