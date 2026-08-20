# MarkGarden Repository Guidelines

MarkGarden is a VS Code extension providing Obsidian-like digital gardening and personal knowledge management (PKM) capabilities (Wikilinks navigation, backlinks, callouts, frontmatter management, daily notes, note refactoring, and interactive graph view).

## Architecture & Project Structure

- `extension.js`: Extension activation, command registrations, tree views, and webview panels.
- `src/`:
  - [`indexer.js`](file:///home/al/Projects/markgarden/src/indexer.js): Core workspace markdown indexing, caching, link resolution, and tag extraction.
  - [`wikilinks.js`](file:///home/al/Projects/markgarden/src/wikilinks.js): Wikilink definition provider, document links, and completion providers.
  - [`backlinks.js`](file:///home/al/Projects/markgarden/src/backlinks.js): Backlinks and unlinked mentions tree data provider.
  - [`graphView.js`](file:///home/al/Projects/markgarden/src/graphView.js): Interactive D3/force-directed 2D/3D graph view webview.
  - [`callouts.js`](file:///home/al/Projects/markgarden/src/callouts.js): Obsidian callout styling and markdown-it rendering plugin.
  - [`frontmatter.js`](file:///home/al/Projects/markgarden/src/frontmatter.js): YAML frontmatter parsing, property IntelliSense, and mutation utilities.
  - [`digitalGarden.js`](file:///home/al/Projects/markgarden/src/digitalGarden.js): Digital garden lifecycle (growth stages, publish status, vault audits).
  - [`dailyNotes.js`](file:///home/al/Projects/markgarden/src/dailyNotes.js): Daily notes creation and format resolution.
  - [`templates.js`](file:///home/al/Projects/markgarden/src/templates.js): Template insertion with dynamic variable expansion.
  - [`hoverProvider.js`](file:///home/al/Projects/markgarden/src/hoverProvider.js): Rich hover preview for wikilinks and note contents.
  - [`noteRefactor.js`](file:///home/al/Projects/markgarden/src/noteRefactor.js): Note splitting and Zettelkasten refactoring.
  - [`tagsCategories.js`](file:///home/al/Projects/markgarden/src/tagsCategories.js): Tag and category management tree views.
- `test/runTests.js`: Standalone unit test suite using mock VS Code API.

## Quality & Release Commands

- **Lint**: `npm run lint`
- **Test**: `npm test`
- **Package**: `npm run package` (or `npx @vscode/vsce package`)
- **Workflows**: Located under [`.agents/workflows/`](file:///home/al/Projects/markgarden/.agents/workflows)
- **CI / GitHub Release**: Configured under [`.github/workflows/`](file:///home/al/Projects/markgarden/.github/workflows)
