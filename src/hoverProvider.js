const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseWikilinkTarget, extractHeadingSection, extractBlockContent, parseFrontmatter } = require('./indexer');
const { getWikilinkAtPosition, resolveMediaFilePath } = require('./wikilinks');

/**
 * Strips frontmatter block from raw markdown content for clean hover display.
 */
function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/**
 * Builds rich markdown preview for a note.
 */
function buildNotePreviewMarkdown(targetPath, parsed, content, maxLength = 1000) {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;

  const baseName = path.basename(targetPath, '.md');
  const frontmatter = parseFrontmatter(content);
  const displayTitle = frontmatter.title || baseName;

  // Block reference preview
  if (parsed.blockId) {
    const block = extractBlockContent(content, parsed.blockId);
    if (block) {
      md.appendMarkdown(`### 📌 **${displayTitle}** \`^${parsed.blockId}\`\n\n`);
      md.appendMarkdown(block.text);
    } else {
      md.appendMarkdown(`### 📌 **${displayTitle}** \`^${parsed.blockId}\`\n\n`);
      md.appendMarkdown(`*Block reference \`^${parsed.blockId}\` not found in "${baseName}".*`);
    }
    return md;
  }

  // Heading section preview
  if (parsed.heading) {
    const section = extractHeadingSection(content, parsed.heading);
    if (section) {
      md.appendMarkdown(`### 🔖 **${displayTitle}** \`#${parsed.heading}\`\n\n`);
      let sectionContent = section.content;
      if (sectionContent.length > maxLength) {
        sectionContent = sectionContent.slice(0, maxLength) + '\n\n*... (section truncated)*';
      }
      md.appendMarkdown(sectionContent);
    } else {
      md.appendMarkdown(`### 🔖 **${displayTitle}** \`#${parsed.heading}\`\n\n`);
      md.appendMarkdown(`*Heading \`#${parsed.heading}\` not found in "${baseName}".*`);
    }
    return md;
  }

  // Whole note preview
  md.appendMarkdown(`### 📄 **${displayTitle}**\n\n`);

  const badges = [];
  if (frontmatter.tags && frontmatter.tags.size > 0) {
    badges.push(`🏷️ ` + Array.from(frontmatter.tags).map(t => `\`#${t}\``).join(' '));
  }
  if (frontmatter.categories && frontmatter.categories.size > 0) {
    badges.push(`📁 ` + Array.from(frontmatter.categories).map(c => `\`${c}\``).join(' '));
  }

  if (badges.length > 0) {
    md.appendMarkdown(badges.join(' &nbsp;|&nbsp; ') + '\n\n---\n\n');
  }

  let body = stripFrontmatter(content);
  if (body.length > maxLength) {
    body = body.slice(0, maxLength) + '\n\n*... (open note to view full content)*';
  }

  md.appendMarkdown(body || '*Empty note*');
  return md;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * HoverProvider that displays instant rich markdown previews for [[wikilinks]], ![[embeds]], #headings, ^block-ids, and media attachments.
 */
class MarkGardenHoverProvider {
  constructor(indexer) {
    this.indexer = indexer;
  }

  provideHover(document, position) {
    const config = vscode.workspace.getConfiguration('markgarden');
    const enabled = config.get('hoverPreviewEnabled', true);
    if (!enabled) return null;

    const link = getWikilinkAtPosition(document, position);
    if (!link) return null;

    const parsed = parseWikilinkTarget(link.target);

    // Media attachment preview branch
    if (parsed.isMedia) {
      const mediaPath = (this.indexer && this.indexer.resolveMediaPath)
        ? this.indexer.resolveMediaPath(parsed.targetNote, document.fileName)
        : resolveMediaFilePath(parsed.targetNote, document.fileName);
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportHtml = true;

      if (mediaPath && fs.existsSync(mediaPath)) {
        const ext = path.extname(mediaPath).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];
        let sizeStr = '';
        try {
          const stat = fs.statSync(mediaPath);
          sizeStr = ` \`${formatFileSize(stat.size)}\``;
        } catch {
          // ignore
        }

        if (imageExts.includes(ext)) {
          const mediaUri = vscode.Uri.file(mediaPath);
          md.appendMarkdown(`### 🖼️ **${path.basename(mediaPath)}**${sizeStr}\n\n![${path.basename(mediaPath)}](${mediaUri.toString()})\n`);
        } else {
          const commandArgs = encodeURIComponent(JSON.stringify({
            target: link.target,
            sourceFile: document.fileName
          }));
          md.appendMarkdown(`### 📄 **${path.basename(mediaPath)}**${sizeStr}\n\n*Media attachment*\n\n[▶️ Open File](command:markgarden.openWikilink?${commandArgs})`);
        }
      } else {
        md.appendMarkdown(`### 🖼️ **${parsed.targetNote}**\n\n*Media file not found in workspace.*`);
      }
      return new vscode.Hover(md, link.range);
    }

    const targetPath = parsed.targetNote
      ? this.indexer.resolveNotePath(parsed.targetNote, document.fileName)
      : document.fileName;

    const maxLength = config.get('hoverPreviewMaxLength', 1200);

    // Non-existent note preview
    if (!targetPath || !fs.existsSync(targetPath)) {
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      const noteName = parsed.targetNote || 'Note';
      const commandArgs = encodeURIComponent(JSON.stringify({
        target: link.target,
        sourceFile: document.fileName
      }));
      md.appendMarkdown(`### 📝 **${noteName}**\n\n*Note does not exist yet.*\n\n[➕ Create Note](command:markgarden.openWikilink?${commandArgs})`);
      return new vscode.Hover(md, link.range);
    }

    // Existing note preview
    try {
      const content = fs.readFileSync(targetPath, 'utf8');
      const md = buildNotePreviewMarkdown(targetPath, parsed, content, maxLength);
      return new vscode.Hover(md, link.range);
    } catch {
      return null;
    }
  }
}

module.exports = {
  MarkGardenHoverProvider,
  buildNotePreviewMarkdown,
  stripFrontmatter
};
