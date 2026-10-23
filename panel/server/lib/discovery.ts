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
    .map((e) => {
      const dir = join(projectsDir, e.name);

      const progressDir = join(dir, "progress");
      let latestProgressDate: string | null = null;
      if (existsSync(progressDir)) {
        const files = readdirSync(progressDir).filter((f) => f.endsWith(".md")).sort();
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
                    `[discovery] ${e.name}/repos.json: invalid openspec config for repo ${String(r?.name)}:`,
                    (err as Error).message,
                  );
                  return [];
                }
              })
            : [];
        } catch (err) {
          console.warn(`[discovery] ${e.name}/repos.json: invalid JSON:`, (err as Error).message);
        }
      }

      return {
        name: e.name,
        path: dir,
        hasIndex: existsSync(join(dir, "_index.json")),
        hasNotes: existsSync(join(dir, "notes")),
        hasProgress: existsSync(join(dir, "progress")),
        hasPlans: existsSync(join(dir, "plans")),
        hasWiki: statSync(join(dir, "wiki"), { throwIfNoEntry: false })?.isDirectory() ?? false,
        latestProgressDate,
        kind: projectKind(projectsDir, e.name),
        lastActivity,
        repos,
      };
    });
}
