---
name: test
description: Run MarkGarden test suite, linter, and validation checks.
---

# MarkGarden Test & Validation Workflow

Use this workflow to test changes and ensure extension health.

## 1. Run Linter
```bash
npm run lint
```

## 2. Run Test Suite
```bash
npm test
```
The test suite in [`test/runTests.js`](file:///home/al/Projects/markgarden/test/runTests.js) validates:
- Note Indexer & Parsers (frontmatter, inline tags, headings, wikilinks, media embeds)
- Tag & Category Mutations
- Template Processing (date/time tokens, title substitutions)
- Graph View Data & Local Subgraphs
- Backlinks & Unlinked Mentions
- Block References & Section Extraction
- Hover Note Previews
- Note Refactor & Zettelkasten tools
- Markdown Preview Renderer Plugins
- Frontmatter Editing & IntelliSense Providers
- Digital Garden Growth Stages & Audits
- Obsidian Callouts Parsing & Rendering

## 3. Test Packaging
```bash
npx @vscode/vsce package
```
Verify that all source files, SVGs, and package metadata are bundled without errors.
