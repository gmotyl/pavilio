import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve, sep } from "path";

import { isProjectDir } from "../project-dir";
import { projectGroup } from "../projects/group";
import { projectKind } from "../projects/kind";
import { slugifyProjectTitle } from "../projects/slug";
import { readActiveProjects, readArchivedProjects } from "../registry";

/**
 * The deterministic half of the knowledge harvest: list and clear the `## Knowledge candidates`
 * and `## Group candidates` of every project wiki, back-link a project source page to a knowledge page, and report how long
 * ago the last harvest ran. The skill does the picking and the page writing.
 */

/** The project the harvest writes into; never a candidate source itself. */
export const KNOWLEDGE_PROJECT = "knowledge";

const CANDIDATES_HEADING = "## Knowledge candidates";
const GROUP_CANDIDATES_HEADING = "## Group candidates";

export type CandidateScope = "generic" | "group";
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
  /** `generic` from `## Knowledge candidates`, `group` from `## Group candidates`. */
  scope: CandidateScope;
  /** For a group item, the origin project's current `group:` (null when it has none any more); null for generic. */
  group: string | null;
};

export type HarvestStatus = {
  lastRun: string | null;
  daysAgo: number | null;
  /** Every candidate waiting, generic and group. */
  waiting: number;
  /** The share of `waiting` from `## Group candidates`. */
  waitingGroup: number;
};

/** Where the harvest writes: the ungrouped knowledge project, and one knowledge project per group. */
export type KnowledgeTargets = { global: string | null; groups: Record<string, string> };

/**
 * Non-archived projects, known the way `resolveProject` knows them: a `PROJECT.md` (discovery's
 * rule) or an active registry row, and never a registry `## Archived Projects` row. Sorted.
 */
function knownProjects(projectsDir: string): string[] {
  if (!existsSync(projectsDir)) return [];
  const active = readActiveProjects(projectsDir);
  const archived = readArchivedProjects(projectsDir);
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "archived")
    .map((e) => e.name)
    .filter((name) => (active.includes(name) || isProjectDir(projectsDir, name)) && !archived.includes(name))
    .sort();
}

/** Non-archived projects with a `wiki/` dir, every knowledge wiki (`kind: knowledge`, grouped or not) excluded. */
function candidateProjects(workspaceRoot: string): string[] {
  const projectsDir = join(workspaceRoot, "projects");
  return knownProjects(projectsDir)
    // By-name `knowledge` exclusion: a stopgap for legacy knowledge cards without `kind:`.
    .filter((name) => name !== KNOWLEDGE_PROJECT && projectKind(projectsDir, name) !== "knowledge")
    .filter((name) => isDir(join(projectsDir, name, "wiki")));
}

/**
 * `scripts/wiki targets`: every non-archived `kind: knowledge` project — no `group:` → `global`,
 * with one → `groups[group]`. Two for one group (or two ungrouped) throw, naming both.
 */
export function knowledgeTargets(workspaceRoot: string): KnowledgeTargets {
  const projectsDir = join(workspaceRoot, "projects");
  const byGroup = new Map<string | null, string[]>();
  for (const name of knownProjects(projectsDir)) {
    if (projectKind(projectsDir, name) !== "knowledge") continue;
    const group = projectGroup(projectsDir, name);
    byGroup.set(group, [...(byGroup.get(group) ?? []), name]);
  }
  const targets: KnowledgeTargets = { global: null, groups: {} };
  for (const [group, names] of byGroup) {
    if (names.length > 1) throw new Error(`ambiguous knowledge target: ${names.join(", ")}`);
    if (group === null) targets.global = names[0];
    else targets.groups[group] = names[0];
  }
  return targets;
}

/** The project name a new group wiki gets: the slugged group plus `-wiki`. */
export function groupWikiName(group: string): string {
  return `${slugifyProjectTitle(group)}-wiki`;
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
function parseCandidate(
  project: string,
  line: string,
  occurrence: number,
  scope: CandidateScope,
  group: string | null,
): Candidate {
  let rest = line.replace(/\r$/, "").replace(/^\s*[-*]\s+/, "");
  const dated = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–:-]\s*)?/.exec(rest);
  const date = dated ? dated[1] : null;
  if (dated) rest = rest.slice(dated[0].length);
  const cited = /\[\[(wiki\/sources\/[^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(rest);
  const source = cited ? cited[1].trim().replace(/\.md$/, "") : null;
  const text = rest.replace(/\s*\(from \[\[[^\]]*\]\]\)\s*$/, "").trim();
  return { id: `${project}#${lineHash(line, occurrence)}`, project, text, details: [], date, source, scope, group };
}

type Found = { /** Line indexes of the bullet and its indented sub-lines. */ indexes: number[]; item: Candidate };

/** Strip the indent every line shares (tabs count as one column, like spaces). */
function dedent(lines: string[]): string[] {
  const indent = Math.min(...lines.map((l) => /^\s*/.exec(l)![0].length));
  return lines.map((l) => l.slice(indent));
}

/**
 * Every candidate of one project — `## Knowledge candidates` then `## Group candidates` — with the
 * lines it spans in `open-questions.md`. Occurrences are counted across both sections, so an
 * identical line in each still gets its own id.
 */
function projectCandidates(workspaceRoot: string, project: string): { lines: string[]; found: Found[] } {
  const path = openQuestionsPath(workspaceRoot, project);
  if (!existsSync(path)) return { lines: [], found: [] };
  const lines = readFileSync(path, "utf8").split("\n");
  const found: Found[] = [];
  const seen = new Map<string, number>();
  const sections: [string, CandidateScope][] = [
    [CANDIDATES_HEADING, "generic"],
    [GROUP_CANDIDATES_HEADING, "group"],
  ];
  for (const [heading, scope] of sections) {
    const range = sectionRange(lines, heading);
    if (!range) continue;
    const group = scope === "group" ? projectGroup(join(workspaceRoot, "projects"), project) : null;
    for (let i = range[0]; i < range[1]; i++) {
      if (!isItem(lines[i])) continue;
      const key = lines[i].replace(/\r$/, "");
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      const item = parseCandidate(project, lines[i], occurrence, scope, group);
      const indexes = [i];
      while (i + 1 < range[1] && isContinuation(lines[i + 1])) indexes.push(++i);
      item.details = dedent(indexes.slice(1).map((at) => lines[at].replace(/\r$/, "").trimEnd()));
      found.push({ indexes, item });
    }
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

/** A link target page without `.md`. */
const normalizePage = (page: string) => page.trim().replace(/\.md$/, "");

const TARGET_PROJECT = /^[A-Za-z0-9._-]+$/;
const TARGET_PAGE = /^wiki\/[^[\]|#\r\n]+$/;

/**
 * `wiki/<slug>` (the `knowledge` project) or `<project>:wiki/<slug>` (`knowledge` or a group
 * wiki), optionally in `[[…]]` and with `.md` → the target project and page. A project name
 * outside `[A-Za-z0-9._-]` (or `.`, or holding `..`) or a page outside `wiki/` throws.
 */
function parseTarget(target: string): { project: string; page: string } {
  const bare = target.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  const colon = bare.indexOf(":");
  const project = colon === -1 ? KNOWLEDGE_PROJECT : bare.slice(0, colon).trim();
  const page = normalizePage(colon === -1 ? bare : bare.slice(colon + 1));
  if (!TARGET_PROJECT.test(project) || project === "." || project.includes("..") || !TARGET_PAGE.test(page)) {
    throw new Error(`invalid backlink target ${JSON.stringify(target)}: expected [<project>:]wiki/<slug>`);
  }
  return { project, page };
}

/**
 * `scripts/wiki backlink`: add `- [[<target project>:<page>]]` (`knowledge` for a bare `wiki/…`
 * target) under the source page's `## Knowledge` heading, created at the end when absent. A page
 * that already links the target is left alone.
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
  const wanted = parseTarget(target);
  const link = `- [[${wanted.project}:${wanted.page}]]`;

  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const range = sectionRange(lines, KNOWLEDGE_HEADING);
  if (range) {
    const section = lines.slice(range[0], range[1]).join("\n");
    for (const m of section.matchAll(/\[\[([^\]|#:]+):([^\]|#]+)/g)) {
      if (m[1].trim() === wanted.project && normalizePage(m[2]) === wanted.page) return { added: false };
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

/**
 * `scripts/wiki harvest-status`: the newest harvest in `knowledge/wiki/log.md` and the backlog
 * size, with the group share split out.
 */
export function harvestStatus(workspaceRoot: string, today: Date): HarvestStatus {
  const { items } = listCandidates(workspaceRoot);
  const waiting = items.length;
  const waitingGroup = items.filter((i) => i.scope === "group").length;
  const log = join(workspaceRoot, "projects", KNOWLEDGE_PROJECT, "wiki", "log.md");
  let lastRun: string | null = null;
  if (existsSync(log)) {
    for (const line of readFileSync(log, "utf8").split("\n")) {
      const m = HARVEST_ENTRY.exec(line);
      if (m && (lastRun === null || m[1] > lastRun)) lastRun = m[1];
    }
  }
  if (lastRun === null) return { lastRun: null, daysAgo: null, waiting, waitingGroup };
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // A log dated ahead of the local clock reads as "today", never as negative days.
  return { lastRun, daysAgo: Math.max(0, daysBetween(lastRun, todayStr)), waiting, waitingGroup };
}
