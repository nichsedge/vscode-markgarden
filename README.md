# Obsidian Notes VS Code Extension

An elegant and high-performance VS Code extension that brings Obsidian's premium **Daily Note** and **Insert Template** workflows directly into your editor. Perfect for Quartz users, markdown journalers, and digital gardeners.

## Features

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
* **Metadata-Rich Dropdown**: Scans your templates folder and reads the YAML frontmatter of each template to display the Title, Filepath, Description, and Tags in an elegant, search-filterable VS Code QuickPick selector.

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

## Extension Settings

Customize settings inside your `settings.json` (Workspace or User) under the `obsidian-notes` prefix:

* `obsidian-notes.templatesFolder`: Path to the folder containing templates relative to your workspace root. *(Default: `"templates"`)*
* `obsidian-notes.dailyNotesFolder`: Path to the directory where daily notes should be saved relative to workspace root. *(Default: `""`, saving in root)*
* `obsidian-notes.dailyNoteTemplate`: The name of the template file to use for daily notes. *(Default: `"daily.md"`)*
* `obsidian-notes.dateFormat`: The date formatting structure used for today's daily note filename. *(Default: `"YYYY-MM-DD"`)*
* `obsidian-notes.openDailyNoteOnStartup`: Boolean setting to automatically open/create today's daily note when you launch the IDE. *(Default: `false`)*

---

## Installation & Setup

You can install this extension either from a packaged `.vsix` file or by building it from source.

### Option 1: Install from VSIX (Recommended)

1. Download the latest `.vsix` package from the [Releases](https://github.com/nichsedge/vscode-obsidian-notes/releases) page.
2. Install it in VS Code or your preferred compatible IDE:
   * **Via Command Line**:
     ```bash
     code --install-extension obsidian-notes-1.0.0.vsix
     ```
   * **Via GUI**: Open the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`), click the **`...`** (Views and More Actions) menu in the top-right corner, select **Install from VSIX...**, and choose the downloaded file.

### Option 2: Build and Install from Source

If you want to modify or build the extension yourself:

1. Clone the repository:
   ```bash
   git clone https://github.com/nichsedge/vscode-obsidian-notes.git
   cd vscode-obsidian-notes
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Package the extension:
   ```bash
   npm run package
   ```
4. Install the generated `.vsix` package:
   ```bash
   code --install-extension obsidian-notes-1.0.0.vsix
   ```

