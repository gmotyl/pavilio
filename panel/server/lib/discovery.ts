import { readdirSync, existsSync, readFileSync, statSync, realpathSync } from "fs";
import { join, relative, isAbsolute, sep, resolve } from "path";
import { getConfig } from "../config.js";
import { parseOpenSpecConfig, type OpenSpecConfig } from "./openspec.js";
import { expandHome } from "./paths.js";
import { isProjectDir } from "./project-dir.js";
import { projectGroup } from "./projects/group.js";
import { projectKind, type ProjectKind } from "./projects/kind.js";

export interface RepoEntry {
  name: string;
  path: string; // exactly as written in repos.json
  present: boolean; // the expanded path is a directory on this machine, re-derived on every read
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
  group: string | null; // `group` from PROJECT.md frontmatter, trimmed; null when absent
  lastActivity: string | null; // YYYY-MM-DD — later of newest progress file and newest wiki log entry
  repos: RepoEntry[];
}

// A wiki log entry heading: `## YYYY-MM-DD HH:MM <op> ...`, or with the date bracketed
// (`## [YYYY-MM-DD] harvest`, which the harvest reader also accepts). Undated `##` headings don't count.
const LOG_HEADING = /^## \[?(\d{4}-\d{2}-\d{2})\b/gm;

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

/**
 * Whether a repos.json `path` names a directory on this machine. Any stat failure
 * (ENOENT, but also ELOOP, EACCES, ...) means "not present": a well-formed entry is
 * never dropped just because its path cannot be inspected here. The path is
 * normalised first, exactly as the git routes resolve a repo root, so a spelling
 * like `/work/old/../spikes` is judged by the directory git would run in.
 */
export function isDirectoryOnThisMachine(path: string): boolean {
  try {
    return statSync(resolve(expandHome(path)), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
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

  const repos = readRepos(dir, name);

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
    group: projectGroup(root, name),
    lastActivity,
    repos,
  };
}

/** `<dir>/repos.json` entries; a malformed file or entry is warned about and skipped. */
export function readRepos(dir: string, name: string): RepoEntry[] {
  const reposPath = join(dir, "repos.json");
  let repos: RepoEntry[] = [];
  if (existsSync(reposPath)) {
    try {
      const raw = JSON.parse(readFileSync(reposPath, "utf-8"));
      repos = Array.isArray(raw)
        ? raw.flatMap((r) => {
            // Per-entry: a malformed `openspec` config on ONE repo must not
            // drop every other repo in the array — skip just that entry.
            // A blank path resolves to the server cwd: it would count as present
            // and its git calls would land in the workspace repository.
            if (
              typeof r?.name !== "string" ||
              typeof r?.path !== "string" ||
              r.path.trim() === ""
            ) {
              console.warn(
                `[discovery] ${name}/repos.json: skipping repo entry without a string name or a non-empty string path:`,
                JSON.stringify(r),
              );
              return [];
            }
            const present = isDirectoryOnThisMachine(r.path);
            try {
              const openspec = parseOpenSpecConfig(r);
              const entry: RepoEntry = { name: r.name, path: r.path, present };
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
  return repos;
}

/**
 * A live project by name: a project dir under projectsDir that, through any symlink,
 * stays inside projectsDir — the rule GET /api/projects/:name applies.
 */
export function isLiveProject(projectsDir: string, name: string): boolean {
  return isProjectName(name) && isProjectDir(projectsDir, name) && resolvesInsideProjectsDir(projectsDir, join(projectsDir, name));
}

/**
 * Every live project's repos.json entries. Reads nothing else, so an unreadable
 * file elsewhere in one project cannot fail a caller that only needs repo links.
 */
export function linkedRepos(): RepoEntry[] {
  const { projectsDir } = getConfig();
  return readdirSync(projectsDir)
    .filter((name) => isLiveProject(projectsDir, name))
    .flatMap((name) => readRepos(join(projectsDir, name), name));
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

/**
 * True when `dir` exists and its realpath lies under `realpath(projectsDir)`. Callers build their
 * read allowlists from the lexical dir, so a symlinked project dir pointing elsewhere must not
 * count as a project at all.
 */
export function resolvesInsideProjectsDir(projectsDir: string, dir: string): boolean {
  try {
    return isContainedPath(relative(realpathSync(projectsDir), realpathSync(dir)));
  } catch {
    return false;
  }
}

/**
 * True when `rel` (from `relative(root, target)`) names a path strictly inside
 * root. `..` counts only as a whole parent segment: a project may be named `..notes`.
 */
export function isContainedPath(rel: string): boolean {
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * The project dir for `name` — live first, then `archived/` — or null when it is in neither, or
 * when it resolves (through a symlink) outside projectsDir.
 */
export function resolveProjectRoot(
  projectsDir: string,
  name: string,
): { root: string; archived: boolean } | null {
  if (!isProjectName(name)) return null;
  if (isProjectDir(projectsDir, name)) {
    return resolvesInsideProjectsDir(projectsDir, join(projectsDir, name)) ? { root: projectsDir, archived: false } : null;
  }
  // Same membership rule as the archive list: any directory under archived/.
  const root = archivedRoot(projectsDir);
  const dir = join(root, name);
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() && resolvesInsideProjectsDir(projectsDir, dir)) {
    return { root, archived: true };
  }
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
