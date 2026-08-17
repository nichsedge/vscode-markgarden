const assert = require('assert');
const Module = require('module');

// Mock 'vscode' for standalone Node test execution
const origRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === 'vscode') {
    return {
      EventEmitter: class {
        constructor() { this.event = () => {}; }
        fire() {}
        dispose() {}
      },
      Range: class { constructor(start, end) { this.start = start; this.end = end; } },
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
  parseWikilinkTarget,
  sanitizeContentForTags
} = require('../src/indexer');
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

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) {
  process.exit(1);
}
