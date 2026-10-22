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
  /** `<project>#<line hash>` — stable while the line is unchanged. */
  id: string;
  project: string;
  text: string;
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
const isItem = (line: string) => /^\s*[-*]\s/.test(line);

/** `[start, end)` line range of the body under `heading`, or null when the heading is absent. */
function sectionRange(lines: string[], heading: string): [number, number] | null {
  const at = lines.findIndex((l) => l.trimEnd() === heading);
  if (at === -1) return null;
  let end = at + 1;
  while (end < lines.length && !isSectionEnd(lines[end])) end++;
  return [at + 1, end];
}

function lineHash(line: string): string {
  return createHash("sha256").update(line.replace(/\r$/, "")).digest("hex").slice(0, 12);
}

/** `- 2026-10-20 — <finding> (from [[wiki/sources/…]])`; date and source are optional. */
function parseCandidate(project: string, line: string): Candidate {
  let rest = line.replace(/\r$/, "").replace(/^\s*[-*]\s+/, "");
  const dated = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–:-]\s*)?/.exec(rest);
  const date = dated ? dated[1] : null;
  if (dated) rest = rest.slice(dated[0].length);
  const cited = /\[\[(wiki\/sources\/[^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(rest);
  const source = cited ? cited[1].trim().replace(/\.md$/, "") : null;
  const text = rest.replace(/\s*\(from \[\[[^\]]*\]\]\)\s*$/, "").trim();
  return { id: `${project}#${lineHash(line)}`, project, text, date, source };
}

/** Every candidate line of one project, with its line index in `open-questions.md`. */
function projectCandidates(workspaceRoot: string, project: string): { lines: string[]; found: { index: number; item: Candidate }[] } {
  const path = openQuestionsPath(workspaceRoot, project);
  if (!existsSync(path)) return { lines: [], found: [] };
  const lines = readFileSync(path, "utf8").split("\n");
  const range = sectionRange(lines, CANDIDATES_HEADING);
  if (!range) return { lines, found: [] };
  const found: { index: number; item: Candidate }[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    if (isItem(lines[i])) found.push({ index: i, item: parseCandidate(project, lines[i]) });
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

/** `scripts/wiki clear-candidates`: drop exactly the lines with these ids; nothing else changes. */
export function clearCandidates(workspaceRoot: string, ids: string[]): { removed: number } {
  const wanted = new Set(ids);
  const projects = new Set(ids.map((id) => id.slice(0, id.lastIndexOf("#"))));
  const known = new Set(candidateProjects(workspaceRoot));
  let removed = 0;
  for (const project of projects) {
    if (!known.has(project)) continue;
    const { lines, found } = projectCandidates(workspaceRoot, project);
    const drop = new Set(found.filter((f) => wanted.has(f.item.id)).map((f) => f.index));
    if (drop.size === 0) continue;
    writeFileSync(
      openQuestionsPath(workspaceRoot, project),
      lines.filter((_, i) => !drop.has(i)).join("\n"),
    );
    removed += drop.size;
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
  return { lastRun, daysAgo: daysBetween(lastRun, todayStr), waiting };
}
