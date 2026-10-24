/**
 * A leading YAML frontmatter block: a `---` line at the very start of the
 * document and the first closing `---` line after it. Only the start of the
 * document counts — a `---` further down is a thematic break, not frontmatter.
 *
 * The browser's copy of the fence `panel/server/lib/projects/frontmatter.ts`
 * splits on (that one parses the YAML too, which the panel never needs to), so
 * a block hidden here is always one the server shows as metadata. YAML's `...`
 * close is deliberately not accepted: the server does not take it either, and
 * a block hidden here but unparsed there would be shown nowhere. The one
 * difference is the optional leading UTF-8 BOM, which WikiTab's fence already
 * tolerated before this helper existed.
 */
const FRONTMATTER_RE = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** `markdown` without its leading frontmatter block, if it has one. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "");
}
