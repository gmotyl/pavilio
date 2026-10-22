import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve, sep } from "path";

import { isProjectDir } from "../project-dir";
import { readActiveProjects, readArchivedProjects } from "../registry";

/**
 * The deterministic half of the knowledge harvest: list and clear the `## Knowledge candidates`
 * of every project wiki, back-link a project source page to a knowledge page, and report how long
 * ago the last harvest ran. The skill does the picking and the page writing.
 */

/** The project the harvest writes into; never a candidate source itself. */
export const KNOWLEDGE_PROJECT = "knowledge";

const CANDIDATES_HEADING = "## Knowledge candidates";
const KNOWLEDGE_HEADING = "## Knowledge";

export type Candidate = {
  /**
   * `<project>#<line hash>` — stable while the line is unchanged. A repeated identical line hashes
   * its occurrence index too, so every candidate has its own id.
   */
  id: string;
  project: string;
  text: string;
  /**
   * The bullet's indented sub-lines, dedented by their common indent — part of the finding, and
   * dropped with it by `clear-candidates`. Not part of `id`, so editing a detail keeps the id.
   */
  details: string[];
  date: string | null;
  /** The cited source page as a project-root path without `.md` (`wiki/sources/…`), or null. */
  source: string | null;
};

export type HarvestStatus = { lastRun: string | null; daysAgo: number | null; waiting: number };

/**
 * Non-archived projects with a `wiki/` dir, `knowledge` excluded. A project is known the way
 * `resolveProject` knows it: a `PROJECT.md` (discovery's rule) or an active registry row, and never
 * a registry `## Archived Projects` row. Sorted for stable output.
 */
function candidateProjects(workspaceRoot: string): string[] {
  const projectsDir = join(workspaceRoot, "projects");
  if (!existsSync(projectsDir)) return [];
  const active = readActiveProjects(projectsDir);
  const archived = readArchivedProjects(projectsDir);
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "archived" && e.name !== KNOWLEDGE_PROJECT)
    .map((e) => e.name)
    .filter((name) => (active.includes(name) || isProjectDir(projectsDir, name)) && !archived.includes(name))
    .filter((name) => isDir(join(projectsDir, name, "wiki")))
    .sort();
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const openQuestionsPath = (workspaceRoot: string, project: string) =>
  join(workspaceRoot, "projects", project, "wiki", "open-questions.md");

/** A heading of level 1 or 2 ends a `##` section. */
const isSectionEnd = (line: string) => /^#{1,2}\s/.test(line);
/** Only a top-level bullet is a candidate; indented lines belong to the bullet above them. */
const isItem = (line: string) => /^[-*]\s/.test(line);
const isContinuation = (line: string) => /^\s+\S/.test(line);

/** `[start, end)` line range of the body under `heading`, or null when the heading is absent. */
function sectionRange(lines: string[], heading: string): [number, number] | null {
  const at = lines.findIndex((l) => l.trimEnd() === heading);
  if (at === -1) return null;
  let end = at + 1;
  while (end < lines.length && !isSectionEnd(lines[end])) end++;
  return [at + 1, end];
}

/** The first occurrence of a line hashes the line alone; the n-th repeat adds `#n`. */
function lineHash(line: string, occurrence: number): string {
  const input = line.replace(/\r$/, "") + (occurrence > 0 ? `\n#${occurrence}` : "");
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/** `- 2026-10-20 — <finding> (from [[wiki/sources/…]])`; date and source are optional. */
function parseCandidate(project: string, line: string, occurrence: number): Candidate {
  let rest = line.replace(/\r$/, "").replace(/^\s*[-*]\s+/, "");
  const dated = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–:-]\s*)?/.exec(rest);
  const date = dated ? dated[1] : null;
  if (dated) rest = rest.slice(dated[0].length);
  const cited = /\[\[(wiki\/sources\/[^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(rest);
  const source = cited ? cited[1].trim().replace(/\.md$/, "") : null;
  const text = rest.replace(/\s*\(from \[\[[^\]]*\]\]\)\s*$/, "").trim();
  return { id: `${project}#${lineHash(line, occurrence)}`, project, text, details: [], date, source };
}

type Found = { /** Line indexes of the bullet and its indented sub-lines. */ indexes: number[]; item: Candidate };

/** Strip the indent every line shares (tabs count as one column, like spaces). */
function dedent(lines: string[]): string[] {
  const indent = Math.min(...lines.map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(indent));
}

/** Every candidate of one project, with the lines it spans in `open-questions.md`. */
function projectCandidates(workspaceRoot: string, project: string): { lines: string[]; found: Found[] } {
  const path = openQuestionsPath(workspaceRoot, project);
  if (!existsSync(path)) return { lines: [], found: [] };
  const lines = readFileSync(path, "utf8").split("\n");
  const range = sectionRange(lines, CANDIDATES_HEADING);
  if (!range) return { lines, found: [] };
  const found: Found[] = [];
  const seen = new Map<string, number>();
  for (let i = range[0]; i < range[1]; i++) {
    if (!isItem(lines[i])) continue;
    const key = lines[i].replace(/\r$/, "");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const item = parseCandidate(project, lines[i], occurrence);
    const indexes = [i];
    while (i + 1 < range[1] && isContinuation(lines[i + 1])) indexes.push(++i);
    item.details = dedent(indexes.slice(1).map((at) => lines[at].replace(/\r$/, "").trimEnd()));
    found.push({ indexes, item });
  }
  return { lines, found };
}

/** `scripts/wiki candidates`. */
export function listCandidates(workspaceRoot: string): { items: Candidate[] } {
  const items = candidateProjects(workspaceRoot).flatMap((p) =>
    projectCandidates(workspaceRoot, p).found.map((f) => f.item),
  );
  return { items };
}

/**
 * `scripts/wiki clear-candidates`: drop exactly the candidates with these ids, each with its
 * indented sub-lines; nothing else changes.
 */
export function clearCandidates(workspaceRoot: string, ids: string[]): { removed: number } {
  const wanted = new Set(ids);
  const projects = new Set(ids.map((id) => id.slice(0, id.lastIndexOf("#"))));
  const known = new Set(candidateProjects(workspaceRoot));
  let removed = 0;
  for (const project of projects) {
    if (!known.has(project)) continue;
    const { lines, found } = projectCandidates(workspaceRoot, project);
    const hits = found.filter((f) => wanted.has(f.item.id));
    if (hits.length === 0) continue;
    const drop = new Set(hits.flatMap((f) => f.indexes));
    writeFileSync(
      openQuestionsPath(workspaceRoot, project),
      lines.filter((_, i) => !drop.has(i)).join("\n"),
    );
    removed += hits.length;
  }
  return { removed };
}

/** A knowledge link target without `.md`, `[[…]]` or the `knowledge:` prefix. */
function normalizeTarget(target: string): string {
  return target
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/^knowledge:/, "")
    .replace(/\.md$/, "");
}

/**
 * `scripts/wiki backlink`: add `- [[knowledge:<target>]]` under the source page's `## Knowledge`
 * heading, created at the end when absent. A page that already links the target is left alone.
 */
export function addBacklink(
  workspaceRoot: string,
  project: string,
  sourcePage: string,
  target: string,
): { added: boolean } {
  const wikiDir = resolve(workspaceRoot, "projects", project, "wiki");
  const rel = sourcePage.endsWith(".md") ? sourcePage : `${sourcePage}.md`;
  const path = resolve(workspaceRoot, "projects", project, rel);
  const inside = relative(wikiDir, path);
  if (!inside || inside.startsWith("..") || inside.startsWith(sep)) {
    throw new Error(`source page must be inside projects/${project}/wiki/: ${sourcePage}`);
  }
  if (!existsSync(path)) throw new Error(`no source page: projects/${project}/${rel}`);
  const wanted = normalizeTarget(target);
  if (!wanted) throw new Error("backlink needs a knowledge target");
  const link = `- [[knowledge:${wanted}]]`;

  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const range = sectionRange(lines, KNOWLEDGE_HEADING);
  if (range) {
    const section = lines.slice(range[0], range[1]).join("\n");
    for (const m of section.matchAll(/\[\[knowledge:([^\]|#]+)/g)) {
      if (normalizeTarget(m[1]) === wanted) return { added: false };
    }
    let at = range[1];
    while (at > range[0] && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, link);
    let next = lines.join("\n");
    if (!next.endsWith("\n")) next += "\n";
    writeFileSync(path, next);
    return { added: true };
  }
  let body = text;
  if (body && !body.endsWith("\n")) body += "\n";
  if (body && !body.endsWith("\n\n")) body += "\n";
  writeFileSync(path, `${body}${KNOWLEDGE_HEADING}\n${link}\n`);
  return { added: true };
}

/** `## [2026-10-12] harvest` (also `## 2026-10-12 14:05 harvest`) → the date. */
const HARVEST_ENTRY = /^##\s+\[?(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\]?\s+harvest\b/;

/** Calendar days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `scripts/wiki harvest-status`: the newest harvest in `knowledge/wiki/log.md` and the backlog size. */
export function harvestStatus(workspaceRoot: string, today: Date): HarvestStatus {
  const waiting = listCandidates(workspaceRoot).items.length;
  const log = join(workspaceRoot, "projects", KNOWLEDGE_PROJECT, "wiki", "log.md");
  let lastRun: string | null = null;
  if (existsSync(log)) {
    for (const line of readFileSync(log, "utf8").split("\n")) {
      const m = HARVEST_ENTRY.exec(line);
      if (m && (lastRun === null || m[1] > lastRun)) lastRun = m[1];
    }
  }
  if (lastRun === null) return { lastRun: null, daysAgo: null, waiting };
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // A log dated ahead of the local clock reads as "today", never as negative days.
  return { lastRun, daysAgo: Math.max(0, daysBetween(lastRun, todayStr)), waiting };
}
