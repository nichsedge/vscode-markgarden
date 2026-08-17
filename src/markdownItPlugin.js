const path = require('path');

const MEDIA_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'webm', 'ogv', 'pdf'
]);

/**
 * Checks if a target string is a media attachment.
 */
function isMediaTarget(target) {
  if (!target) return false;
  const clean = target.split('|')[0].trim().split('#')[0].trim();
  const ext = path.extname(clean).toLowerCase().replace(/^\./, '');
  return MEDIA_EXTS.has(ext);
}

/**
 * Parses raw wikilink target string into components.
 */
function parseWikilinkTargetForMarkdownIt(raw) {
  let text = raw.trim();
  let alias = '';
  let heading = '';
  let blockId = '';
  let targetNote = '';

  const pipeIdx = text.indexOf('|');
  if (pipeIdx !== -1) {
    alias = text.slice(pipeIdx + 1).trim();
    text = text.slice(0, pipeIdx).trim();
  }

  const hashIdx = text.indexOf('#');
  if (hashIdx !== -1) {
    const anchor = text.slice(hashIdx + 1).trim();
    if (anchor.startsWith('^')) {
      blockId = anchor.slice(1).trim();
    } else {
      heading = anchor;
    }
    targetNote = text.slice(0, hashIdx).trim();
  } else {
    targetNote = text.trim();
  }

  return {
    raw,
    targetNote,
    heading,
    blockId,
    alias,
    isMedia: isMediaTarget(targetNote)
  };
}

const { markdownItCalloutsPlugin } = require('./callouts');

/**
 * Registers Obsidian Wikilinks, Embeds, and Callouts plugin into a markdown-it instance.
 */
function registerMarkdownItWikilinks(md) {
  markdownItCalloutsPlugin(md);

  md.core.ruler.after('inline', 'obsidian_wikilinks', state => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'inline' || !token.children) continue;

      const newChildren = [];

      for (let j = 0; j < token.children.length; j++) {
        const child = token.children[j];

        if (child.type !== 'text') {
          newChildren.push(child);
          continue;
        }

        const text = child.content;
        const regex = /(!?\[\[)([^[\r\n\]]+)\]\]/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
          // Text preceding the wikilink
          if (match.index > lastIndex) {
            const textToken = new state.Token('text', '', 0);
            textToken.content = text.slice(lastIndex, match.index);
            newChildren.push(textToken);
          }

          const isEmbed = match[1] === '![[';
          const parsed = parseWikilinkTargetForMarkdownIt(match[2]);

          if (parsed.isMedia) {
            // Image / Media embed or link
            const mediaFileName = parsed.targetNote;
            const altText = parsed.alias || mediaFileName;

            if (isEmbed || isMediaTarget(mediaFileName)) {
              const imgToken = new state.Token('image', 'img', 0);
              imgToken.attrs = [
                ['src', mediaFileName],
                ['alt', altText],
                ['title', altText]
              ];
              const altToken = new state.Token('text', '', 0);
              altToken.content = altText;
              imgToken.children = [altToken];
              newChildren.push(imgToken);
            } else {
              const linkOpen = new state.Token('link_open', 'a', 1);
              linkOpen.attrs = [
                ['href', mediaFileName],
                ['class', 'obsidian-media-link'],
                ['title', mediaFileName]
              ];
              const textToken = new state.Token('text', '', 0);
              textToken.content = altText;
              const linkClose = new state.Token('link_close', 'a', -1);
              newChildren.push(linkOpen, textToken, linkClose);
            }
          } else {
            // Note wikilink or transclusion
            const targetNoteName = parsed.targetNote;
            let label = parsed.alias || targetNoteName;
            if (!targetNoteName && parsed.heading) {
              label = `#${parsed.heading}`;
            } else if (!targetNoteName && parsed.blockId) {
              label = `#^${parsed.blockId}`;
            }

            let hrefTarget = targetNoteName ? `${targetNoteName}.md` : '';
            if (parsed.heading) hrefTarget += `#${parsed.heading}`;

            const linkOpen = new state.Token('link_open', 'a', 1);
            linkOpen.attrs = [
              ['href', hrefTarget],
              ['class', 'obsidian-wikilink'],
              ['data-wikilink-target', parsed.raw]
            ];

            const textToken = new state.Token('text', '', 0);
            textToken.content = isEmbed ? `![[${label}]]` : label;

            const linkClose = new state.Token('link_close', 'a', -1);
            newChildren.push(linkOpen, textToken, linkClose);
          }

          lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
          const textToken = new state.Token('text', '', 0);
          textToken.content = text.slice(lastIndex);
          newChildren.push(textToken);
        }
      }

      token.children = newChildren;
    }
  });

  return md;
}

module.exports = {
  registerMarkdownItWikilinks,
  parseWikilinkTargetForMarkdownIt
};
