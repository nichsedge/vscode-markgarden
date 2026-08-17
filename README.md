# Obsidian Notes VS Code Extension

An elegant and high-performance VS Code extension that brings Obsidian's premium note-taking workflows directly into your editor: **Interactive Graph View**, **Wikilinks Navigation (`[[ ]]`)**, **Tag & Category Management**, **Daily Notes**, and **Smart Template Insertion**. Perfect for Quartz users, markdown journalers, and digital gardeners.

---

## Features

### 🕸️ Interactive Graph View & Local Graph
Visualize your knowledge network with a stunning, physics-driven force-directed graph:
* **Global Graph**: Explore the full landscape of your digital garden, note relationships, and clusters.
* **Local Graph Mode**: Focus directly on your active note and dynamically filter to immediate neighbors (customizable depth: 1-hop, 2-hop, 3-hop, 4-hop).
* **Live Synchronization**: Updates in real-time as notes and wikilinks are created, edited, or deleted.
* **Search & Filters**:
  - Live search by note title.
  - Filter and highlight nodes by tag or category.
  - Toggle orphan notes (notes with zero links).
* **Interactive Physics & Controls**:
  - Smooth pan, zoom, and node dragging.
  - Node hover highlights connected notes and displays rich metadata tooltips (Title, Path, Tags, Categories, and Inbound/Outbound link counts).
  - Single click on any node opens the markdown note in the editor.
  - Fit-to-screen view and simulation pause/resume.
* **Commands & Shortcuts**:
  - `Obsidian Notes: Open Graph View` (`Ctrl+Alt+G` / `Cmd+Alt+G` or click the graph icon in the editor title bar).
  - `Obsidian Notes: Open Local Graph View`.

### 🔗 Wikilink Navigation & Auto-Creation (`[[ ]]`)
Experience seamless cross-note hyperlinking just like in Obsidian:
* **Interactive Jumping**: `Ctrl/Cmd+Click` or `F12` (Go to Definition) on any `[[Note Name]]` to jump straight to the target note.
* **Heading Anchors**: Link directly to section headers with `[[Note#Section]]` or within the current file `[[#Section]]`. The editor scrolls directly to the heading line.
* **Display Aliases**: Support for pipe syntax `[[Target Note|Custom Display Text]]`.
* **Automatic Note Creation**: Clicking a non-existent note link prompts/creates it automatically at your preferred location with initial title metadata and opens it in the editor.
* **Follow Link Shortcut**: Press `Alt+Enter` on any link to navigate instantly.
* **IntelliSense Autocompletion**: Typing `[[` suggests note titles and note headings across the workspace.

### 🏷️ Tag & Category Management
Organize your second brain with full hybrid tag and category support:
* **Hybrid Tag Detection**: Automatically indexes YAML frontmatter (`tags: [...]` or multi-line list) and inline hashtags (`#productivity`, `#project/alpha/v1`).
* **Category Support**: Automatically indexes YAML frontmatter (`categories: [...]` or `category: ...`).
* **Sidebar Activity Bar Views**:
  - **Tags Explorer**: Displays all workspace tags with note count badges (e.g. `🏷️ project (5)`). Expand to view matching notes and click to open.
  - **Categories Explorer**: Displays all workspace categories with note counts and note drill-downs.
* **Command Palette Actions**:
  - `Obsidian Notes: Add Tag to Current Note` (adds to YAML frontmatter or inline)
  - `Obsidian Notes: Remove Tag from Current Note`
  - `Obsidian Notes: Add Category to Current Note`
  - `Obsidian Notes: Remove Category from Current Note`
  - `Obsidian Notes: Find Notes by Tag` (QuickPick search)
  - `Obsidian Notes: Find Notes by Category` (QuickPick search)
  - `Obsidian Notes: Rename Tag Across Workspace` (batch updates frontmatter and inline hashtags across all markdown notes)
  - `Obsidian Notes: Rename Category Across Workspace` (batch updates frontmatter across all markdown notes)
* **Tag IntelliSense**: Typing `#` provides autocompletion of existing workspace tags (smartly filtered to ignore markdown `# Heading` syntax, code blocks, and URLs).

### 🔍 Hover Note Previews & Transclusion (`![[ ]]`)
Inspect connected thoughts without losing your place:
* **Rich Hover Tooltips**: Hover over any `[[Note Name]]`, `[[Note#Section]]`, `[[Note#^block-id]]`, or `![[Embed]]` in the editor to view an instant markdown tooltip showing note title, tags, category badges, and clean note preview.
* **Anchor-Specific Peeking**: Hovering over a `#heading` or `^block-id` link isolates and previews only that specific subsection or paragraph.
* **Missing Note Indicator**: Hovering over an uncreated note link displays a one-click *"Create Note"* quick action.

### ✂️ Note Refactor & Zettelkasten Extraction
Effortlessly distill brain dumps and daily journals into atomic concept notes:
* **Extract Selection to Note**: Select any markdown text and press `Ctrl+Alt+E` / `Cmd+Alt+E` (or right-click -> *Extract Selection to Note*).
* **Smart Title Suggestion**: Automatically infers a clean note title from the selection's top heading or opening sentence.
* **Flexible Replacement Modes**:
  - Replace with `[[New Note]]` wikilink (default).
  - Replace with `![[New Note]]` transclusion embed.
  - Replace with `[[New Note|Custom Alias]]`.
  - Create note without modifying the selection in source note.
* **Automatic Frontmatter & Source Backlinks**: Generated notes automatically include YAML frontmatter with date and a bidirectional backlink `source: "[[Source Note]]"`.

### 📌 Block References (`^block-id`)
Link to granular paragraphs, quotes, and list items across your workspace:
* **Block Anchors**: End any paragraph or bullet item with ` ^my-block-id`.
* **Block Autocompletion**: Typing `[[Note#^` or `[[#^` suggests all indexed block IDs in the note with preview snippets.
* **Block Navigation & Definition**: `Ctrl/Cmd+Click` or `F12` on `[[Note#^my-block-id]]` jumps and centers directly on that block's line.

### 📅 Daily Note
Create or open today's daily log file instantly. 
* **Command**: `Obsidian Notes: Create Daily Note`
* **Keyboard Shortcut**: `Ctrl+Alt+D` (Windows/Linux) or `Cmd+Alt+D` (macOS)
* **Smart Templating**: If today's daily note doesn't exist, it's automatically created. If a template is configured (e.g. `templates/daily.md`), it is read, parsed, and populated with resolved timestamps and filename values.
* **Auto-Open**: Optionally open or create your daily note automatically on editor startup.

### 📝 Insert Template
Quickly insert processed markdown templates into your active markdown file at the cursor position.
* **Command**: `Obsidian Notes: Insert Template`
* **Keyboard Shortcut**: `Ctrl+Alt+T` (Windows/Linux) or `Cmd+Alt+T` (macOS)
* **Metadata-Rich Dropdown**: Scans your templates folder and reads the YAML frontmatter of each template to display Title, Filepath, Description, and Tags in an elegant, search-filterable VS Code QuickPick selector.

---

## Supported Template Variables

Placeholders are resolved at the moment of file creation or insertion relative to the target document:

* `{{title}}` - The name of the file being edited or created (without the `.md` extension).
* `{{date}}` - Today's date (defaults to `YYYY-MM-DD`).
* `{{date:FORMAT}}` - Today's date formatted using customized tokens.
* `{{time}}` - Current time (defaults to `HH:mm`).
* `{{time:FORMAT}}` - Current time formatted using customized tokens.

### Date/Time Format Tokens
* `YYYY` - 4-digit Year (e.g., `2026`)
* `MM` - 2-digit Month (e.g., `05`)
* `DD` - 2-digit Day (e.g., `20`)
* `HH` - 2-digit Hour (e.g., `18`)
* `mm` - 2-digit Minute (e.g., `55`)
* `ss` - 2-digit Second (e.g., `30`)
* `Z` - Timezone offset formatted precisely (e.g., `+07:00`, `-05:00`, or `Z`)

*Example: `{{date:YYYY-MM-DDTHH:mm:ssZ}}` yields `2026-05-20T18:55:30+07:00`.*

---

## Keyboard Shortcuts

| Shortcut | Command | When |
|---|---|---|
| `Ctrl+Alt+G` / `Cmd+Alt+G` | Open Graph View | Global |
| `Alt+Enter` | Follow Wikilink Under Cursor | Active Markdown Document |
| `Ctrl+Alt+E` / `Cmd+Alt+E` | Extract Selection to Note (Zettelkasten) | Active Selection in Markdown |
| `Ctrl+Alt+D` / `Cmd+Alt+D` | Create / Open Today's Daily Note | Global |
| `Ctrl+Alt+T` / `Cmd+Alt+T` | Insert Markdown Template | Active Editor |

---

## Extension Settings

Customize settings inside your `settings.json` (Workspace or User) under the `obsidian-notes` prefix:

| Setting | Type | Default | Description |
|---|---|---|---|
| `obsidian-notes.hoverPreviewEnabled` | `boolean` | `true` | Show rich markdown preview tooltip when hovering over `[[links]]`, `![[embeds]]`, headings, and blocks. |
| `obsidian-notes.hoverPreviewMaxLength` | `number` | `1200` | Maximum character length for hover preview body before truncation. |
| `obsidian-notes.newNoteFolderStrategy` | `string` | `"root"` | Where to create new notes when following a non-existent `[[link]]`: `"root"`, `"sameAsCurrent"`, or `"custom"`. |
| `obsidian-notes.notesFolder` | `string` | `""` | Destination folder path for new notes when strategy is `"custom"`. |
| `obsidian-notes.tagPrefix` | `string` | `"frontmatter"` | Default insertion style when adding tags: `"frontmatter"` (YAML frontmatter) or `"inline"` (`#tag` at end of file). |
| `obsidian-notes.templatesFolder` | `string` | `"templates"` | Path to the templates directory relative to workspace root. |
| `obsidian-notes.dailyNotesFolder` | `string` | `""` | Path to daily notes folder relative to workspace root. |
| `obsidian-notes.dailyNoteTemplate` | `string` | `"daily.md"` | Name of the daily note template file. |
| `obsidian-notes.dateFormat` | `string` | `"YYYY-MM-DD"` | Format for today's daily note filename. |
| `obsidian-notes.openDailyNoteOnStartup` | `boolean` | `false` | Automatically open or create today's daily note on startup. |
| `obsidian-notes.excludedFolders` | `array` | `["**/node_modules/**", "**/.git/**", ...]` | Glob patterns to exclude from metadata and tag indexing. |

---

## Installation & Setup

### Option 1: Install from VSIX

1. Download the latest `.vsix` package from the [Releases](https://github.com/nichsedge/vscode-obsidian-notes/releases) page.
2. Install it in VS Code:
   ```bash
   code --install-extension obsidian-notes-1.2.0.vsix
   ```
   Or open Extensions view (`Ctrl+Shift+X`), click **`...`** (Views and More Actions) > **Install from VSIX...**.

### Option 2: Build from Source

```bash
git clone https://github.com/nichsedge/vscode-obsidian-notes.git
cd vscode-obsidian-notes
npm install
npm test
npm run package
code --install-extension obsidian-notes-1.2.0.vsix
```
