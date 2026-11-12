// Imported by the client bundle (src/features/markdown) — keep free of node imports.

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
  label: string; // trimmed text after `|`, else shortLabel(target)
};

const PROJECT_PREFIX = /^([A-Za-z0-9][\w.-]*):(.+)$/;

// Optional record kind (source-page `<kind>` list), a date, an optional time
// (`_08-02-58`, `_1945`), then the descriptive remainder.
const DATED_NAME =
  /^(?:(?:note|memo|progress|adr|proposal|design|snippet|context-snapshot|context)-)?\d{4}-\d{2}-\d{2}(?:[_-]\d{2}-?\d{2}(?:-?\d{2})?)?[-_](.+)$/;

/** Display text for a wikilink target with no explicit label (design § Decisions 1). */
export function shortLabel(target: string): string {
  const name = target.slice(target.lastIndexOf("/") + 1);
  const dated = DATED_NAME.exec(name);
  const rest = dated ? dated[1].replace(/[-_]/g, " ").trim() : "";
  return rest || name;
}

/** Parse the inside of `[[…]]`; null when it is not a usable link (empty, or escapes the project). */
export function parseWikiLink(raw: string): WikiLink | null {
  const pipe = raw.indexOf("|");
  const ref = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
  const explicit = pipe === -1 ? "" : raw.slice(pipe + 1).trim();
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
  return { raw, ...(project ? { project } : {}), target: path, label: explicit || shortLabel(path) };
}

/** Same-length run of spaces, so offsets outside code stay valid. */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

type Fence = { char: string; len: number };

const FENCE_MARK = /^ {0,3}(`{3,}|~{3,})/;

/** The code fence `line` opens (≤3 spaces of indent, then 3+ backticks or tildes), else null. */
export function fenceOpener(line: string): Fence | null {
  const open = FENCE_MARK.exec(line);
  return open ? { char: open[1][0], len: open[1].length } : null;
}

/** Whether `line` closes `fence`: the same character, at least as long, and nothing after it. */
export function closesFence(line: string, fence: Fence): boolean {
  const mark = FENCE_MARK.exec(line);
  return !!mark && mark[1][0] === fence.char && mark[1].length >= fence.len
    && line.slice(mark[0].length).trim() === "";
}

/** Replace fenced code blocks and inline code spans with whitespace. */
function maskCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
      lines[i] = blank(lines[i]);
    } else {
      fence = fenceOpener(lines[i]);
      if (fence) lines[i] = blank(lines[i]);
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
