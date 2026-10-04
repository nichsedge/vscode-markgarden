# MarkGarden Repository Guidelines

MarkGarden is a VS Code extension providing Obsidian-like digital gardening and personal knowledge management (PKM) capabilities (Wikilinks navigation, backlinks, callouts, frontmatter management, daily notes, note refactoring, interactive graph view, and built-in Model Context Protocol server).

## Architecture & Project Structure

- `src/`:
  - [`extension.ts`](file:///home/al/Projects/markgarden/src/extension.ts): Extension activation, command registrations, tree views, and webview panels.
  - [`indexer.ts`](file:///home/al/Projects/markgarden/src/indexer.ts): Core workspace markdown indexing, caching, link resolution, and tag extraction.
  - [`wikilinks.ts`](file:///home/al/Projects/markgarden/src/wikilinks.ts): Wikilink definition provider, document links, and completion providers.
  - [`backlinks.ts`](file:///home/al/Projects/markgarden/src/backlinks.ts): Backlinks and unlinked mentions tree data provider.
  - [`graphView.ts`](file:///home/al/Projects/markgarden/src/graphView.ts): Interactive D3/force-directed 2D/3D graph view webview.
  - [`callouts.ts`](file:///home/al/Projects/markgarden/src/callouts.ts): Obsidian callout styling and markdown-it rendering plugin.
  - [`markdownItPlugin.ts`](file:///home/al/Projects/markgarden/src/markdownItPlugin.ts): Markdown-it wikilinks and embed transclusion AST transformer.
  - [`frontmatter.ts`](file:///home/al/Projects/markgarden/src/frontmatter.ts): YAML frontmatter parsing, property IntelliSense, and mutation utilities.
  - [`digitalGarden.ts`](file:///home/al/Projects/markgarden/src/digitalGarden.ts): Digital garden lifecycle (growth stages, publish status, vault audits).
  - [`dailyNotes.ts`](file:///home/al/Projects/markgarden/src/dailyNotes.ts): Daily notes creation and format resolution.
  - [`templates.ts`](file:///home/al/Projects/markgarden/src/templates.ts): Template insertion with dynamic variable expansion.
  - [`hoverProvider.ts`](file:///home/al/Projects/markgarden/src/hoverProvider.ts): Rich hover preview for wikilinks and note contents.
  - [`noteRefactor.ts`](file:///home/al/Projects/markgarden/src/noteRefactor.ts): Note splitting and Zettelkasten refactoring.
  - [`tagsCategories.ts`](file:///home/al/Projects/markgarden/src/tagsCategories.ts): Tag and category management tree views.
  - [`mcpServer.ts`](file:///home/al/Projects/markgarden/src/mcpServer.ts): Embedded Model Context Protocol (MCP) server providing vault query tools.
  - [`mcpProvider.ts`](file:///home/al/Projects/markgarden/src/mcpProvider.ts): VS Code MCP server definition provider integration.
- `dist/`: CommonJS runtime bundles targeting Node (`dist/extension.js` and `dist/mcpServer.js`).
- `test/`:
  - [`setup.ts`](file:///home/al/Projects/markgarden/test/setup.ts): Test runner setup and VS Code module mocking.
  - [`mockVscode.ts`](file:///home/al/Projects/markgarden/test/mockVscode.ts): Mock implementation of the VS Code extension API.
  - [`runTests.ts`](file:///home/al/Projects/markgarden/test/runTests.ts): Standalone unit test suite using Bun test runner.

## Quality & Release Commands

- **Install**: `bun install`
- **Typecheck**: `bun run compile` (`tsc --noEmit`)
- **Lint**: `bun run lint` (`eslint . --ext .ts`)
- **Test**: `bun test` or `bun test/runTests.ts`
- **Build**: `bun run build` (builds `dist/extension.js` and `dist/mcpServer.js`)
- **Package**: `bun run package` (or `npx @vscode/vsce package`)
- **Workflows**: Located under [`.agents/workflows/`](file:///home/al/Projects/markgarden/.agents/workflows)
- **CI / GitHub Release**: Configured under [`.github/workflows/`](file:///home/al/Projects/markgarden/.github/workflows) using Bun.
