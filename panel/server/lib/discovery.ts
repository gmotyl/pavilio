import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { getConfig } from "../config.js";
import { parseOpenSpecConfig, type OpenSpecConfig } from "./openspec.js";

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
  latestProgressDate: string | null;
  repos: RepoEntry[];
}

export function discoverProjects(): Project[] {
  const { projectsDir } = getConfig();
  const entries = readdirSync(projectsDir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(projectsDir, e.name, "PROJECT.md")))
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

      // Read repos.json if present
      const reposPath = join(dir, "repos.json");
      let repos: RepoEntry[] = [];
      if (existsSync(reposPath)) {
        try {
          const raw = JSON.parse(readFileSync(reposPath, "utf-8"));
          repos = Array.isArray(raw)
            ? raw.map((r) => {
                const openspec = parseOpenSpecConfig(r);
                const entry: RepoEntry = { name: r.name, path: r.path };
                if (openspec) entry.openspec = openspec;
                return entry;
              })
            : [];
        } catch { /* ignore malformed */ }
      }

      return {
        name: e.name,
        path: dir,
        hasIndex: existsSync(join(dir, "_index.json")),
        hasNotes: existsSync(join(dir, "notes")),
        hasProgress: existsSync(join(dir, "progress")),
        hasPlans: existsSync(join(dir, "plans")),
        latestProgressDate,
        repos,
      };
    });
}
