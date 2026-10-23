import { readdirSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getConfig } from "../config.js";
import { parseOpenSpecConfig, type OpenSpecConfig } from "./openspec.js";
import { isProjectDir } from "./project-dir.js";
import { projectKind, type ProjectKind } from "./projects/kind.js";

export interface RepoEntry {
  name: string;
  path: string;
  openspec?: OpenSpecConfig;
}

export interface Project {
  name: string;
  path: string;
  hasIndex: boolean;
  hasNotes: boolean;
  hasProgress: boolean;
  hasPlans: boolean;
  hasWiki: boolean; // `<project>/wiki/` is a directory — gates the wiki tab
  latestProgressDate: string | null;
  kind: ProjectKind; // `kind` from PROJECT.md frontmatter, default `project`
  lastActivity: string | null; // YYYY-MM-DD — later of newest progress file and newest wiki log entry
  repos: RepoEntry[];
}

// A wiki log entry heading: `## YYYY-MM-DD HH:MM <op> ...`. Undated `##` headings don't count.
const LOG_HEADING = /^## (\d{4}-\d{2}-\d{2})\b/gm;

/** The newest dated `##` heading in `<project>/wiki/log.md`, or null when there is none. */
function latestWikiLogDate(dir: string): string | null {
  const logPath = join(dir, "wiki", "log.md");
  if (!existsSync(logPath)) return null;
  let latest: string | null = null;
  for (const m of readFileSync(logPath, "utf-8").matchAll(LOG_HEADING)) {
    if (latest === null || m[1] > latest) latest = m[1];
  }
  return latest;
}

export function discoverProjects(): Project[] {
  const { projectsDir } = getConfig();
  const entries = readdirSync(projectsDir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .filter((e) => isProjectDir(projectsDir, e.name))
    .map((e) => readProject(projectsDir, e.name));
}

/**
 * Read one project dir `<root>/<name>`. `root` is `projectsDir` for a live project and
 * `<projectsDir>/archived` for an archived one; the caller has already checked the dir exists.
 */
export function readProject(root: string, name: string): Project {
  const dir = join(root, name);

  const progressDir = join(dir, "progress");
  let latestProgressDate: string | null = null;
  if (existsSync(progressDir)) {
    // Only dated session files (YYYY-MM-DD-*.md) count; BRIEFING.md, handoffs etc. do not.
    const files = readdirSync(progressDir)
      .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}/.test(f))
      .sort();
    if (files.length > 0) {
      latestProgressDate = files[files.length - 1].slice(0, 10);
    }
  }

  const wikiLogDate = latestWikiLogDate(dir);
  const lastActivity =
    latestProgressDate && wikiLogDate
      ? latestProgressDate > wikiLogDate
        ? latestProgressDate
        : wikiLogDate
      : (latestProgressDate ?? wikiLogDate);

  // Read repos.json if present
  const reposPath = join(dir, "repos.json");
  let repos: RepoEntry[] = [];
  if (existsSync(reposPath)) {
    try {
      const raw = JSON.parse(readFileSync(reposPath, "utf-8"));
      repos = Array.isArray(raw)
        ? raw.flatMap((r) => {
            // Per-entry: a malformed `openspec` config on ONE repo must not
            // drop every other repo in the array — skip just that entry.
            try {
              const openspec = parseOpenSpecConfig(r);
              const entry: RepoEntry = { name: r.name, path: r.path };
              if (openspec) entry.openspec = openspec;
              return [entry];
            } catch (err) {
              console.warn(
                `[discovery] ${name}/repos.json: invalid openspec config for repo ${String(r?.name)}:`,
                (err as Error).message,
              );
              return [];
            }
          })
        : [];
    } catch (err) {
      console.warn(`[discovery] ${name}/repos.json: invalid JSON:`, (err as Error).message);
    }
  }

  return {
    name,
    path: dir,
    hasIndex: existsSync(join(dir, "_index.json")),
    hasNotes: existsSync(join(dir, "notes")),
    hasProgress: existsSync(join(dir, "progress")),
    hasPlans: existsSync(join(dir, "plans")),
    hasWiki: statSync(join(dir, "wiki"), { throwIfNoEntry: false })?.isDirectory() ?? false,
    latestProgressDate,
    kind: projectKind(root, name),
    lastActivity,
    repos,
  };
}

/** Archived projects live in `<projectsDir>/archived/<name>`. */
export function archivedRoot(projectsDir: string): string {
  return join(projectsDir, "archived");
}

/**
 * When an archived project was archived: its dir mtime (`POST /api/archive/:name` touches it).
 * The archive list and the project detail both report this value.
 */
export function archivedAt(archivedDir: string): string {
  return statSync(archivedDir).mtime.toISOString();
}

export type ProjectDetail = Project & { archived: boolean; archivedAt?: string };

/** True for a single path segment that can name a project dir (no separators, no dot-dirs). */
function isProjectName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[/\\]/.test(name) && !name.includes("\0");
}

/** The project dir for `name` — live first, then `archived/` — or null when it is in neither. */
export function resolveProjectRoot(
  projectsDir: string,
  name: string,
): { root: string; archived: boolean } | null {
  if (!isProjectName(name)) return null;
  if (isProjectDir(projectsDir, name)) return { root: projectsDir, archived: false };
  // Same membership rule as the archive list: any directory under archived/.
  const root = archivedRoot(projectsDir);
  if (statSync(join(root, name), { throwIfNoEntry: false })?.isDirectory()) return { root, archived: true };
  return null;
}

/** One project by name, falling back to `archived/`; null when it is in neither place. */
export function findProject(name: string): ProjectDetail | null {
  const { projectsDir } = getConfig();
  const found = resolveProjectRoot(projectsDir, name);
  if (!found) return null;
  const project = readProject(found.root, name);
  return found.archived
    ? { ...project, archived: true, archivedAt: archivedAt(join(found.root, name)) }
    : { ...project, archived: false };
}
