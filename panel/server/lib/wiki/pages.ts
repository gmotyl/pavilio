import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";
import { parse as parseYaml } from "yaml";

export const ENTITY_KINDS = ["person", "repository", "service", "organization"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Typed view of a wiki page's frontmatter. Every field is optional: a field that is
 * missing or has the wrong type is simply absent, so callers never see a bad shape.
 */
export type WikiFrontmatter = {
  type?: string;
  description?: string;
  entities?: string[];
  concepts?: string[];
  record?: string; // workspace path of the source record
  raw?: string; // raw-layer path
  created?: string; // YYYY-MM-DD
  updated?: string; // YYYY-MM-DD
  kind?: EntityKind; // entity pages only
  title?: string;
  aliases?: string[];
  sources?: string[];
};

/** `frontmatterError`: a frontmatter fence exists but its YAML does not parse (frontmatter is `{}`). */
export type ParsedPage = { frontmatter: WikiFrontmatter; body: string; frontmatterError?: string };

export type WikiPage = ParsedPage & {
  path: string; // relative to the wiki dir, always "/"-separated
};

const STRING_FIELDS = ["type", "description", "record", "raw", "title"] as const;
const LIST_FIELDS = ["entities", "concepts", "aliases", "sources"] as const;
const DATE_FIELDS = ["created", "updated"] as const;

const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Split a page into typed frontmatter and body; never throws (a YAML error is reported instead). */
export function parsePage(text: string): ParsedPage {
  // Editors on Windows may save a UTF-8 BOM, which would hide the opening fence.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const match = FENCE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const body = text.slice(match[0].length);
  let data: unknown;
  try {
    // A duplicated key must not cost the whole frontmatter; the last value wins.
    data = parseYaml(match[1] ?? "", { uniqueKeys: false });
  } catch (err) {
    // First line only: the YAML library appends a multi-line source excerpt.
    const message = (err instanceof Error ? err.message : String(err)).split("\n")[0].trim();
    return { frontmatter: {}, body, frontmatterError: message || "invalid YAML" };
  }
  return { frontmatter: toFrontmatter(data), body };
}

/**
 * A list entry as a string. YAML reads an unquoted wikilink item `- [[wiki/sources/a]]` as a
 * nested flow sequence `[["wiki/sources/a"]]`; a one-string inner sequence is folded back to
 * `[[wiki/sources/a]]`. Anything else that is not a string is dropped.
 */
function listItem(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === "string") {
    return `[[${v[0][0]}]]`;
  }
  return null;
}

function toFrontmatter(data: unknown): WikiFrontmatter {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const raw = data as Record<string, unknown>;
  const fm: WikiFrontmatter = {};
  for (const key of STRING_FIELDS) {
    if (typeof raw[key] === "string") fm[key] = raw[key];
  }
  for (const key of LIST_FIELDS) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    // A whole field written as one unquoted link, `aliases: [[x]]`, arrives as `[["x"]]`.
    const items = listItem(value) !== null ? [value] : value;
    fm[key] = items.map(listItem).filter((v): v is string => v !== null);
  }
  for (const key of DATE_FIELDS) {
    const value = raw[key];
    if (typeof value === "string") fm[key] = value;
    // Defensive: a YAML 1.1 timestamp would arrive as a Date.
    else if (value instanceof Date && !isNaN(value.getTime())) fm[key] = value.toISOString().slice(0, 10);
  }
  if (typeof raw.kind === "string" && (ENTITY_KINDS as readonly string[]).includes(raw.kind)) {
    fm.kind = raw.kind as EntityKind;
  }
  return fm;
}

/** Wiki-relative paths the walk never yields: the raw layer and the ingest ledger. */
function isExcluded(relPath: string): boolean {
  return relPath === "log.md" || relPath === "raw" || relPath.startsWith("raw/");
}

/**
 * Every `.md` page under `wikiDir` except `raw/` and `log.md`, sorted by path.
 * A missing wiki dir yields an empty list.
 */
export function walkWikiPages(wikiDir: string): WikiPage[] {
  const pages: WikiPage[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(wikiDir, abs).split(sep).join("/");
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) visit(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        pages.push({ path: rel, ...parsePage(readFileSync(abs, "utf8")) });
      }
    }
  };
  visit(wikiDir);
  // Code-unit order, not locale order, so the result is identical on every machine.
  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
