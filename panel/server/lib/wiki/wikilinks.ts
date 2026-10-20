/**
 * Pure wikilink parsing (D14) — no `fs`, no `path`, so the client markdown renderer can reuse it.
 *
 * Syntax: `[[<path from project root>]]`, optional `<project>:` prefix, no `.md`, optional
 * `|label` suffix — e.g. `[[wiki/concepts/x]]`, `[[metro:wiki/entities/y|Y]]`.
 */

export type WikiLink = {
  raw: string; // text between the brackets, as written
  project?: string; // set only when the link carries a `<project>:` prefix
  target: string; // project-relative path, "/"-separated, without `.md`
  label: string; // text after `|`, else `raw` without the label part
};

const PROJECT_PREFIX = /^([A-Za-z0-9][\w.-]*):(.+)$/;

/** Parse the inside of `[[…]]`; null when it is not a usable link (empty, or escapes the project). */
export function parseWikiLink(raw: string): WikiLink | null {
  const pipe = raw.indexOf("|");
  const ref = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
  const label = pipe === -1 ? ref : raw.slice(pipe + 1).trim() || ref;
  let project: string | undefined;
  let path = ref;
  const prefixed = PROJECT_PREFIX.exec(ref);
  if (prefixed) {
    project = prefixed[1];
    path = prefixed[2];
  }
  path = path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
  const segments = path.split("/");
  if (!path || segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return { raw, ...(project ? { project } : {}), target: path, label };
}

/** Same-length run of spaces, so offsets outside code stay valid. */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** Replace fenced code blocks and inline code spans with whitespace. */
function maskCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      const close = open && open[1][0] === fence.char && open[1].length >= fence.len
        && lines[i].slice(open[0].length).trim() === "";
      lines[i] = blank(lines[i]);
      if (close) fence = null;
    } else if (open) {
      fence = { char: open[1][0], len: open[1].length };
      lines[i] = blank(lines[i]);
    }
  }
  // Inline code: a backtick run closed by a run of the same length (CommonMark).
  return lines.join("\n").replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, blank);
}

const LINK = /\[\[([^\[\]\n]+)\]\]/g;

/** Every parsable `[[…]]` in document order, skipping inline code and fenced blocks. */
export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of maskCode(markdown).matchAll(LINK)) {
    const link = parseWikiLink(match[1]);
    if (link) links.push(link);
  }
  return links;
}

/**
 * Backlink-map key for a link seen from `fromProject`: the project-relative target without
 * `.md` (`wiki/concepts/x`), prefixed with `<project>:` only when it points into another project.
 */
export function wikiLinkKey(link: WikiLink, fromProject: string): string {
  return link.project && link.project !== fromProject ? `${link.project}:${link.target}` : link.target;
}
