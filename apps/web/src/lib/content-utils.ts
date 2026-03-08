/** Content detection and preprocessing utilities for Nostr post rendering. */

/** Fast-reject JSON detection — avoids try/catch overhead for most text. */
export function isJSON(str: string): boolean {
  const s = str.trim();
  if (s.length < 2) return false;
  if (s[0] !== '{' && s[0] !== '[' && s[0] !== '"') return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escape Nostr-style hashtags so they don't become Markdown headings.
 *
 * Markdown interprets `# word` at the start of a line as a heading.
 * Nostr hashtags like `#hashtag` at the start of a line would be mangled.
 *
 * Strategy: replace `#word` (no space between # and word) with a zero-width
 * space placeholder that survives the Markdown parser, then we render the
 * hashtag as a styled span in the custom components.
 *
 * We also need to handle `#hashtag` mid-line — those are fine for Markdown,
 * but we still want to style them.  We use a token wrapper for all hashtags.
 */
const HASHTAG_RE = /(?:^|\s)#([A-Za-z0-9_\u00C0-\u024F]+)/g;

export function escapeHashtags(text: string): string {
  // Replace #tag with a safe token that won't be parsed as a heading.
  // We use `\u200B` (zero-width space) before the `#` when it's at line-start
  // so Markdown doesn't treat it as ATX heading.
  return text.replace(HASHTAG_RE, (match, tag) => {
    const leadingSpace = match[0] === '#' ? '' : match[0];
    return `${leadingSpace}\u200B#${tag}`;
  });
}

/** URL regex — matches http(s) URLs in plain text. */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** Common image extensions for URL detection. */
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i;

/** Common video extensions for URL detection. */
const VIDEO_EXTS = /\.(mp4|webm|mov|ogg)(\?[^\s]*)?$/i;

export interface ParsedUrl {
  url: string;
  type: 'image' | 'video' | 'link';
}

/** Extract URLs from text and classify them. */
export function extractUrls(text: string): ParsedUrl[] {
  const matches = text.match(URL_RE);
  if (!matches) return [];
  const seen = new Set<string>();
  return matches
    .filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; })
    .map((url) => ({
      url,
      type: IMAGE_EXTS.test(url) ? 'image' as const
        : VIDEO_EXTS.test(url) ? 'video' as const
        : 'link' as const,
    }));
}

/**
 * Determine the content type of a Nostr post for rendering decisions.
 * Priority: JSON > has-media-urls > plain-text (rendered as markdown).
 */
export type ContentType = 'json' | 'rich' | 'text';

export function classifyContent(content: string): ContentType {
  if (isJSON(content)) return 'json';
  const urls = extractUrls(content);
  if (urls.some((u) => u.type === 'image' || u.type === 'video')) return 'rich';
  return 'text';
}
