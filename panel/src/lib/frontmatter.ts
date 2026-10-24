/**
 * A leading YAML frontmatter block: an optional UTF-8 BOM, a `---` line at the
 * very start of the document, and the first closing `---` (or YAML's `...`)
 * line after it. Only the start of the document counts — a `---` further down
 * is a thematic break, not frontmatter.
 *
 * The browser's copy of the fence `server/lib/projects/frontmatter.ts` splits
 * on; that one parses the YAML too, which the panel never needs to.
 */
const FRONTMATTER_RE = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** `markdown` without its leading frontmatter block, if it has one. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "");
}
