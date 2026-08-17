const assert = require('assert');
const Module = require('module');

// Mock 'vscode' for standalone Node test execution
const origRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === 'vscode') {
    return {
      EventEmitter: class {
        constructor() { this.event = () => ({ dispose() {} }); }
        fire() {}
        dispose() {}
      },
      Range: class { constructor(start, end) { this.start = start; this.end = end; } },
      MarkdownString: class {
        constructor(val) { this.value = val || ''; this.isTrusted = false; this.supportHtml = false; }
        appendMarkdown(str) { this.value += str; }
      },
      Uri: {
        file: (p) => ({ fsPath: p, path: p, toString: () => `file://${p}` }),
        parse: (s) => ({ fsPath: s, path: s, toString: () => s })
      },
      workspace: {
        workspaceFolders: [],
        getWorkspaceFolder: () => null,
        getConfiguration: () => ({ get: (k, d) => d })
      },
      window: {},
      commands: {},
      languages: {},
      ThemeIcon: class {},
      TreeItem: class {},
      TreeItemCollapsibleState: {}
    };
  }
  return origRequire.apply(this, arguments);
};

const {
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
} = require('../src/indexer');
const {
  buildNotePreviewMarkdown,
  stripFrontmatter
} = require('../src/hoverProvider');
const {
  deriveDefaultTitle,
  generateRefactoredNoteContent
} = require('../src/noteRefactor');
const {
  registerMarkdownItWikilinks
} = require('../src/markdownItPlugin');
const {
  addTagToMarkdown,
  removeTagFromMarkdown,
  addCategoryToMarkdown,
  removeCategoryFromMarkdown,
  renameTagInMarkdown,
  renameCategoryInMarkdown
} = require('../src/tagsCategories');
const { processTemplate, formatDateTime } = require('../src/templates');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

console.log('Running Obsidian Notes Unit Tests...\n');

// --- Indexer Tests ---
console.log('Indexer & Parsers:');

test('parseFrontmatter extracts bracketed tags and categories', () => {
  const md = `---\ntitle: "My Note"\ntags: [journal, personal]\ncategories: ["Daily Logs", "Work"]\n---\n# Content`;
  const result = parseFrontmatter(md);
  assert.strictEqual(result.title, 'My Note');
  assert.strictEqual(result.tags.has('journal'), true);
  assert.strictEqual(result.tags.has('personal'), true);
  assert.strictEqual(result.categories.has('Daily Logs'), true);
  assert.strictEqual(result.categories.has('Work'), true);
});

test('parseFrontmatter extracts yaml list syntax tags and single category', () => {
  const md = `---\ntitle: Project X\ntags:\n  - coding\n  - 'web/frontend'\ncategory: Projects\n---\n# Hello`;
  const result = parseFrontmatter(md);
  assert.strictEqual(result.title, 'Project X');
  assert.strictEqual(result.tags.has('coding'), true);
  assert.strictEqual(result.tags.has('web/frontend'), true);
  assert.strictEqual(result.categories.has('Projects'), true);
});

test('sanitizeContentForTags strips code blocks, inline code, and URLs', () => {
  const md = `# Header\nSome text with https://example.com/#anchor and \`#inlineCode\` and:\n\`\`\`javascript\nconst x = #notATag;\n\`\`\`\nValid #actualTag here.`;
  const sanitized = sanitizeContentForTags(md);
  assert.strictEqual(sanitized.includes('https://'), false);
  assert.strictEqual(sanitized.includes('notATag'), false);
  assert.strictEqual(sanitized.includes('inlineCode'), false);
  assert.strictEqual(sanitized.includes('#actualTag'), true);
});

test('extractInlineTags extracts simple and nested hashtags', () => {
  const md = `Note body containing #productivity and #project/alpha/v1 and #tag-with-dash. #123 should be ignored.`;
  const tags = extractInlineTags(md);
  assert.strictEqual(tags.has('productivity'), true);
  assert.strictEqual(tags.has('project/alpha/v1'), true);
  assert.strictEqual(tags.has('tag-with-dash'), true);
  assert.strictEqual(tags.has('123'), false);
});

test('extractHeadings extracts headings with line numbers', () => {
  const md = `Intro text\n# Main Title\nParagraph\n## Section 1\n### Subsection`;
  const headings = extractHeadings(md);
  assert.strictEqual(headings.length, 3);
  assert.strictEqual(headings[0].text, 'Main Title');
  assert.strictEqual(headings[0].level, 1);
  assert.strictEqual(headings[0].line, 1);
  assert.strictEqual(headings[1].text, 'Section 1');
  assert.strictEqual(headings[1].level, 2);
  assert.strictEqual(headings[1].line, 3);
});

test('findPrimaryDocHeading distinguishes top document titles from sub-section headers', () => {
  const docWithTopHeading = `---\ndate: 2026-08-17\n---\n# Top Title\n\nBody content...`;
  const headings1 = extractHeadings(docWithTopHeading);
  assert.strictEqual(findPrimaryDocHeading(docWithTopHeading, headings1), 'Top Title');

  const docWithMidSectionHeading = `---\ndate: 2021-06-25\n---\n[[01 Link]]\n\n# Extras\n[[Link 2]]`;
  const headings2 = extractHeadings(docWithMidSectionHeading);
  assert.strictEqual(findPrimaryDocHeading(docWithMidSectionHeading, headings2), '');
});

test('parseWikilinkTarget handles various wikilink formats', () => {
  const simple = parseWikilinkTarget('Target Note');
  assert.strictEqual(simple.targetNote, 'Target Note');
  assert.strictEqual(simple.heading, '');
  assert.strictEqual(simple.alias, '');

  const withHeading = parseWikilinkTarget('Target Note#My Heading');
  assert.strictEqual(withHeading.targetNote, 'Target Note');
  assert.strictEqual(withHeading.heading, 'My Heading');

  const withAlias = parseWikilinkTarget('Target Note|Display Name');
  assert.strictEqual(withAlias.targetNote, 'Target Note');
  assert.strictEqual(withAlias.alias, 'Display Name');

  const withHeadingAndAlias = parseWikilinkTarget('Target Note#Section|Alias Text');
  assert.strictEqual(withHeadingAndAlias.targetNote, 'Target Note');
  assert.strictEqual(withHeadingAndAlias.heading, 'Section');
  assert.strictEqual(withHeadingAndAlias.alias, 'Alias Text');

  const localHeading = parseWikilinkTarget('#Local Section');
  assert.strictEqual(localHeading.targetNote, '');
  assert.strictEqual(localHeading.heading, 'Local Section');
});

// --- Tag & Category Mutator Tests ---
console.log('\nTag & Category Mutations:');

test('addTagToMarkdown adds tag to existing frontmatter', () => {
  const md = `---\ntitle: "Test"\ntags: ["alpha"]\n---\n# Body`;
  const updated = addTagToMarkdown(md, 'beta');
  const meta = parseFrontmatter(updated);
  assert.strictEqual(meta.tags.has('alpha'), true);
  assert.strictEqual(meta.tags.has('beta'), true);
});

test('addTagToMarkdown creates frontmatter if absent', () => {
  const md = `# Just Body`;
  const updated = addTagToMarkdown(md, 'newTag');
  assert.strictEqual(updated.startsWith('---\ntags: ["newTag"]\n---'), true);
  assert.strictEqual(updated.includes('# Just Body'), true);
});

test('removeTagFromMarkdown removes tag from frontmatter and inline', () => {
  const md = `---\ntags: ["keep", "removeMe"]\n---\n# Body with #removeMe inline`;
  const updated = removeTagFromMarkdown(md, 'removeMe');
  const meta = parseFrontmatter(updated);
  assert.strictEqual(meta.tags.has('keep'), true);
  assert.strictEqual(meta.tags.has('removeMe'), false);
  assert.strictEqual(updated.includes('#removeMe'), false);
});

test('addCategoryToMarkdown and removeCategoryFromMarkdown manipulate categories', () => {
  const md = `---\ntitle: "Doc"\n---\n# Hello`;
  const withCat = addCategoryToMarkdown(md, 'Work');
  const meta = parseFrontmatter(withCat);
  assert.strictEqual(meta.categories.has('Work'), true);

  const removedCat = removeCategoryFromMarkdown(withCat, 'Work');
  const metaAfter = parseFrontmatter(removedCat);
  assert.strictEqual(metaAfter.categories.has('Work'), false);
});

test('renameTagInMarkdown renames in frontmatter and inline hashtags', () => {
  const md = `---\ntitle: "Note"\ntags: ["oldProject", "keep"]\n---\nWorking on #oldProject and #oldProject/subtask today.`;
  const updated = renameTagInMarkdown(md, 'oldProject', 'newProject');
  const meta = parseFrontmatter(updated);
  assert.strictEqual(meta.tags.has('newProject'), true);
  assert.strictEqual(meta.tags.has('oldProject'), false);
  assert.strictEqual(updated.includes('#newProject and #newProject/subtask'), true);
});

test('renameCategoryInMarkdown renames category in frontmatter', () => {
  const md = `---\ntitle: "Note"\ncategories: ["OldCat", "Other"]\n---\nBody`;
  const updated = renameCategoryInMarkdown(md, 'OldCat', 'NewCat');
  const meta = parseFrontmatter(updated);
  assert.strictEqual(meta.categories.has('NewCat'), true);
  assert.strictEqual(meta.categories.has('OldCat'), false);
});

// --- Template Processor Tests ---
console.log('\nTemplate Processing:');

test('formatDateTime formats date with custom tokens', () => {
  const date = new Date(2026, 4, 20, 15, 30, 45);
  const formatted = formatDateTime(date, 'YYYY/MM/DD - HH:mm:ss');
  assert.strictEqual(formatted, '2026/05/20 - 15:30:45');
});

test('processTemplate replaces {{title}}, {{date}}, and {{time}}', () => {
  const template = `# {{title}}\nCreated on {{date:YYYY-MM-DD}} at {{time:HH:mm}}`;
  const date = new Date(2026, 4, 20, 15, 30);
  const result = processTemplate(template, 'My Special Note', date);
  assert.strictEqual(result.includes('# My Special Note'), true);
  assert.strictEqual(result.includes('Created on 2026-05-20 at 15:30'), true);
});

// --- Graph Data Tests ---
console.log('\nGraph View Data:');

test('extractWikilinks extracts multiple links from markdown', () => {
  const md = `See [[Note A]] and [[Note B#Heading|Alias]] and [[#Local Heading]].`;
  const links = extractWikilinks(md);
  assert.strictEqual(links.length, 3);
  assert.strictEqual(links[0].targetNote, 'Note A');
  assert.strictEqual(links[1].targetNote, 'Note B');
  assert.strictEqual(links[1].heading, 'Heading');
  assert.strictEqual(links[1].alias, 'Alias');
  assert.strictEqual(links[2].targetNote, '');
});

test('getGraphData produces correct global nodes, links, and local subgraph', () => {
  const indexer = new WorkspaceNotesIndexer();
  
  indexer.indexFileContent('/workspace/noteA.md', `# Note A\nLinks to [[Note B]] and [[Note C]].`);
  indexer.indexFileContent('/workspace/noteB.md', `# Note B\nLinks to [[Note C]].`);
  indexer.indexFileContent('/workspace/noteC.md', `# Note C\nLinks to [[Note D]].`);
  indexer.indexFileContent('/workspace/noteD.md', `# Note D\nNo links.`);
  indexer.indexFileContent('/workspace/orphan.md', `# Orphan Note\nNo links.`);

  // Re-resolve link targets now that all notes are indexed
  indexer._resolveAllLinkTargets();

  // 1. Global graph
  const globalGraph = indexer.getGraphData(null, 0);
  assert.strictEqual(globalGraph.nodes.length, 5);
  assert.strictEqual(globalGraph.links.length, 4);

  // 2. Local graph around noteA with depth = 1 (should include noteA, noteB, noteC)
  const localGraphDepth1 = indexer.getGraphData('/workspace/noteA.md', 1);
  const nodeLabels1 = localGraphDepth1.nodes.map(n => n.label);
  assert.strictEqual(nodeLabels1.includes('Note A'), true);
  assert.strictEqual(nodeLabels1.includes('Note B'), true);
  assert.strictEqual(nodeLabels1.includes('Note C'), true);
  assert.strictEqual(nodeLabels1.includes('Note D'), false);
  assert.strictEqual(nodeLabels1.includes('Orphan Note'), false);

  // 3. Local graph around noteA with depth = 2 (should include noteD through noteC)
  const localGraphDepth2 = indexer.getGraphData('/workspace/noteA.md', 2);
  const nodeLabels2 = localGraphDepth2.nodes.map(n => n.label);
  assert.strictEqual(nodeLabels2.includes('Note D'), true);
  assert.strictEqual(nodeLabels2.includes('Orphan Note'), false);
});

// --- Backlinks & Unlinked Mentions Tests ---
console.log('\nBacklinks & Unlinked Mentions:');

test('parseFrontmatter extracts aliases', () => {
  const md = `---\ntitle: "AI Trading"\naliases: [Trading AI, Algo Trading]\n---\n# Content`;
  const result = parseFrontmatter(md);
  assert.strictEqual(result.title, 'AI Trading');
  assert.strictEqual(result.aliases.has('Trading AI'), true);
  assert.strictEqual(result.aliases.has('Algo Trading'), true);
});

test('getBacklinksForFile returns linking notes and line snippets', async () => {
  const indexer = new WorkspaceNotesIndexer();
  indexer.indexFileContent('/workspace/target.md', `# Target Note\nMain target.`);
  indexer.indexFileContent('/workspace/source.md', `Line 1\nCheck [[Target Note]] on line 2.`);
  indexer._resolveAllLinkTargets();

  const backlinks = await indexer.getBacklinksForFile('/workspace/target.md');
  assert.strictEqual(backlinks.length, 1);
  assert.strictEqual(backlinks[0].sourceFilePath, '/workspace/source.md');
  assert.strictEqual(backlinks[0].snippets.length, 1);
  assert.strictEqual(backlinks[0].snippets[0].line, 1);
  assert.strictEqual(backlinks[0].snippets[0].lineText, 'Check [[Target Note]] on line 2.');
});

test('getUnlinkedMentionsForFile detects title and alias mentions', async () => {
  const indexer = new WorkspaceNotesIndexer();
  indexer.indexFileContent('/workspace/target.md', `---\ntitle: "Target Note"\naliases: [Special Alias]\n---\nMain target.`);
  indexer.indexFileContent('/workspace/mention.md', `I am talking about Target Note in plain text.\nAlso using Special Alias here.`);
  indexer.indexFileContent('/workspace/existing.md', `Already linked: [[Target Note]].`);

  const unlinked = await indexer.getUnlinkedMentionsForFile('/workspace/target.md');
  assert.strictEqual(unlinked.length, 1);
  assert.strictEqual(unlinked[0].sourceFilePath, '/workspace/mention.md');
  assert.strictEqual(unlinked[0].mentions.length, 2);
  assert.strictEqual(unlinked[0].mentions[0].term, 'Target Note');
  assert.strictEqual(unlinked[0].mentions[1].term, 'Special Alias');
});

// --- Block References & Section Extraction Tests ---
console.log('\nBlock References & Section Extraction:');

test('extractBlockReferences finds block IDs and stripped text', () => {
  const md = `# Title\n\nFirst paragraph with a quote. ^quote-1\n\n- List item 1\n- List item 2 ^item-2\n\nRegular paragraph without block.`;
  const blocks = extractBlockReferences(md);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].id, 'quote-1');
  assert.strictEqual(blocks[0].line, 2);
  assert.strictEqual(blocks[0].text, 'First paragraph with a quote.');
  assert.strictEqual(blocks[1].id, 'item-2');
  assert.strictEqual(blocks[1].line, 5);
  assert.strictEqual(blocks[1].text, '- List item 2');
});

test('extractBlockContent locates specific block by id', () => {
  const md = `Intro text.\n\nImportant insight on PKM workflows. ^pkm-insight\n\nOutro text.`;
  const block = extractBlockContent(md, 'pkm-insight');
  assert.notStrictEqual(block, null);
  assert.strictEqual(block.id, 'pkm-insight');
  assert.strictEqual(block.text, 'Important insight on PKM workflows.');

  const missing = extractBlockContent(md, 'non-existent');
  assert.strictEqual(missing, null);
});

test('extractHeadingSection extracts heading content without bleeding into next heading', () => {
  const md = `# Overview\nIntro content.\n\n## Section One\nContent for section one.\n### Subsection 1.1\nDetails here.\n\n## Section Two\nContent for section two.`;
  const section = extractHeadingSection(md, 'Section One');
  assert.notStrictEqual(section, null);
  assert.strictEqual(section.heading.text, 'Section One');
  assert.strictEqual(section.content.includes('Content for section one.'), true);
  assert.strictEqual(section.content.includes('Subsection 1.1'), true);
  assert.strictEqual(section.content.includes('Section Two'), false);
});

test('parseWikilinkTarget parses block anchors and embeds', () => {
  const blockLink = parseWikilinkTarget('My Note#^block-123');
  assert.strictEqual(blockLink.targetNote, 'My Note');
  assert.strictEqual(blockLink.blockId, 'block-123');
  assert.strictEqual(blockLink.heading, '');

  const localBlock = parseWikilinkTarget('#^local-id');
  assert.strictEqual(localBlock.targetNote, '');
  assert.strictEqual(localBlock.blockId, 'local-id');

  const embedLinks = extractWikilinks('Look at ![[Embedded Note]] and [[Normal Link]].');
  assert.strictEqual(embedLinks.length, 2);
  assert.strictEqual(embedLinks[0].targetNote, 'Embedded Note');
  assert.strictEqual(embedLinks[0].isEmbed, true);
  assert.strictEqual(embedLinks[1].targetNote, 'Normal Link');
  assert.strictEqual(embedLinks[1].isEmbed, false);
});

test('isMediaFile detects image/media embeds and extractWikilinks filters them out', () => {
  assert.strictEqual(isMediaFile('kaiki_deishu.jpg'), true);
  assert.strictEqual(isMediaFile('kaiki_deishu.jpg|300'), true);
  assert.strictEqual(isMediaFile('diagram.png'), true);
  assert.strictEqual(isMediaFile('document.pdf'), true);
  assert.strictEqual(isMediaFile('Note Title.md'), false);
  assert.strictEqual(isMediaFile('Note Title'), false);

  const md = `Check ![[kaiki_deishu.jpg]] and ![[kaiki_deishu.jpg|300]] and [[Actual Note]].`;
  const links = extractWikilinks(md);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].targetNote, 'Actual Note');

  const indexer = new WorkspaceNotesIndexer();
  indexer.mediaToPathIndex.set('op.jpg', new Set(['/workspace/content/assets/Write/op.jpg']));
  const resolved = indexer.resolveMediaPath('op.jpg', '/workspace/content/Write/note.md');
  assert.strictEqual(resolved, '/workspace/content/assets/Write/op.jpg');
});

// --- Hover Note Previews Tests ---
console.log('\nHover Note Previews:');

test('stripFrontmatter removes frontmatter block cleanly', () => {
  const md = `---\ntitle: "Hello"\n---\nActual content here.`;
  assert.strictEqual(stripFrontmatter(md), 'Actual content here.');
});

test('buildNotePreviewMarkdown formats whole note with frontmatter tags and badges', () => {
  const md = `---\ntitle: "Deep Learning Guide"\ntags: [ai, ml]\ncategory: Technology\n---\n# Deep Learning\n\nNeural networks overview.`;
  const parsed = parseWikilinkTarget('Deep Learning Guide');
  const hoverMd = buildNotePreviewMarkdown('/workspace/Deep Learning Guide.md', parsed, md);
  assert.strictEqual(hoverMd.value.includes('Deep Learning Guide'), true);
  assert.strictEqual(hoverMd.value.includes('🏷️ `#ai` `#ml`'), true);
  assert.strictEqual(hoverMd.value.includes('📁 `Technology`'), true);
  assert.strictEqual(hoverMd.value.includes('Neural networks overview.'), true);
  assert.strictEqual(hoverMd.value.includes('---'), true);
});

test('buildNotePreviewMarkdown formats heading preview specifically', () => {
  const md = `# Note\n\n## Subtopic\nTargeted subtopic details.\n\n## Another`;
  const parsed = parseWikilinkTarget('Note#Subtopic');
  const hoverMd = buildNotePreviewMarkdown('/workspace/Note.md', parsed, md);
  assert.strictEqual(hoverMd.value.includes('🔖 **Note** `#Subtopic`'), true);
  assert.strictEqual(hoverMd.value.includes('Targeted subtopic details.'), true);
  assert.strictEqual(hoverMd.value.includes('Another'), false);
});

test('buildNotePreviewMarkdown formats block reference preview specifically', () => {
  const md = `# Note\n\nKey finding statement. ^key-finding\n\nOther text.`;
  const parsed = parseWikilinkTarget('Note#^key-finding');
  const hoverMd = buildNotePreviewMarkdown('/workspace/Note.md', parsed, md);
  assert.strictEqual(hoverMd.value.includes('📌 **Note** `^key-finding`'), true);
  assert.strictEqual(hoverMd.value.includes('Key finding statement.'), true);
  assert.strictEqual(hoverMd.value.includes('Other text.'), false);
});

// --- Note Refactor Tests ---
console.log('\nNote Refactor & Zettelkasten:');

test('deriveDefaultTitle derives clean title from headers or sentences', () => {
  assert.strictEqual(deriveDefaultTitle('## Advanced Prompt Engineering\nSome text'), 'Advanced Prompt Engineering');
  assert.strictEqual(deriveDefaultTitle('- [ ] Research quantum algorithms for optimization'), 'Research quantum algorithms for optimization');
  assert.strictEqual(deriveDefaultTitle('> Quote from literature book'), 'Quote from literature book');
  assert.strictEqual(deriveDefaultTitle('Plain first sentence of a paragraph.'), 'Plain first sentence of a paragraph.');
});

test('generateRefactoredNoteContent builds valid frontmatter and backlink', () => {
  const content = generateRefactoredNoteContent('Atomic Idea', 'This is the extracted body.', 'Daily Log 2026-08-17', '2026-08-17T00:00:00Z');
  assert.strictEqual(content.includes('title: "Atomic Idea"'), true);
  assert.strictEqual(content.includes('source: "[[Daily Log 2026-08-17]]"'), true);
  assert.strictEqual(content.includes('# Atomic Idea'), true);
  assert.strictEqual(content.includes('This is the extracted body.'), true);
});

// --- Markdown Preview Plugin Tests ---
console.log('\nMarkdown Preview Renderer Plugin:');

test('registerMarkdownItWikilinks transforms [[wikilinks]] and ![[embeds]] into HTML AST tokens', () => {
  class MockToken {
    constructor(type, tag, nesting) {
      this.type = type;
      this.tag = tag;
      this.nesting = nesting;
      this.content = '';
      this.children = null;
      this.attrs = null;
    }
  }

  class MockMarkdownIt {
    constructor() {
      this.Token = MockToken;
      this.rules = [];
      this.core = {
        ruler: {
          after: (afterRule, name, fn) => {
            this.rules.push(fn);
          }
        }
      };
    }

    renderInline(text) {
      const inlineToken = new MockToken('inline', '', 0);
      const textToken = new MockToken('text', '', 0);
      textToken.content = text;
      inlineToken.children = [textToken];
      const state = { tokens: [inlineToken], Token: MockToken };

      for (const rule of this.rules) {
        rule(state);
      }
      return inlineToken.children;
    }
  }

  const md = new MockMarkdownIt();
  registerMarkdownItWikilinks(md);

  const tokens = md.renderInline('Check [[My Note|Alias]] and ![[photo.jpg]] here.');
  assert.strictEqual(tokens.length, 7);
  assert.strictEqual(tokens[0].content, 'Check ');
  assert.strictEqual(tokens[1].type, 'link_open');
  assert.strictEqual(tokens[2].content, 'Alias');
  assert.strictEqual(tokens[3].type, 'link_close');
  assert.strictEqual(tokens[4].content, ' and ');
  assert.strictEqual(tokens[5].type, 'image');
  assert.strictEqual(tokens[5].attrs[0][1], 'photo.jpg');
  assert.strictEqual(tokens[6].content, ' here.');
});

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) {
  process.exit(1);
}
