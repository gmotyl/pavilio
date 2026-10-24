import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";

import { isProjectDir } from "../project-dir";
import { gitEnv } from "../wiki/clone-repo";
import { assertContainedDir, isDanglingLink } from "../wiki/contained-dir";
import { projectKind } from "./kind";

/**
 * `scripts/project spike-repo <p>` — the research project's spikes repo: the git repo
 * `<spikesRoot>/<p>`, created (and `git init`ed) when missing and registered in
 * `projects/<p>/repos.json` as `{ name: "<p>-spikes", path: "<spikesRoot as written>/<p>" }`.
 *
 * Every refusal is checked before anything is written, so a refused run leaves the disk as it was.
 */
export type SpikeRepoOptions = {
  projectsDir: string;
  project: string;
  /** `research.spikesRoot` as configured — `~` is kept in `repos.json`, expanded on disk. */
  spikesRoot: string;
  /** What `~` expands to. */
  home: string;
};

export type SpikeRepoResult =
  | { ok: true; path: string; repo: "created" | "existing"; registered: boolean }
  /** 1: error; 2: ask the user (the dir is occupied by something that is not a repo). */
  | { ok: false; code: 1; error: string }
  | { ok: false; code: 2; reason: "occupied"; path: string; error: string };

type RepoEntry = { name?: unknown; path?: unknown };

/** `~` and `~/…` → under `home`; absolute paths as is; anything else is not a usable root. */
function expandHome(path: string, home: string): string | null {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return isAbsolute(path) ? path : null;
}

function readEntries(reposPath: string): RepoEntry[] | string {
  if (!existsSync(reposPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(reposPath, "utf8"));
  } catch (err) {
    return `${reposPath}: invalid JSON (${(err as Error).message})`;
  }
  return Array.isArray(raw) ? (raw as RepoEntry[]) : `${reposPath}: not a JSON array`;
}

/**
 * Temp file in the same dir + rename: `rename` replaces the directory entry, so a hard-linked
 * `repos.json` is never written through (the shared inode outside the project stays as it was),
 * and a crash never leaves a half-written file. The temp file is removed on failure.
 */
function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: "wx" });
    renameSync(tmp, file);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Best effort — the original failure is the one worth reporting.
    }
    throw err;
  }
}

export function ensureSpikeRepo(options: SpikeRepoOptions): SpikeRepoResult {
  const { projectsDir, project, home } = options;
  if (!isProjectDir(projectsDir, project)) {
    return { ok: false, code: 1, error: `no such project: ${project}` };
  }
  if (projectKind(projectsDir, project) !== "research") {
    return { ok: false, code: 1, error: `${project} is not a research project (kind: research)` };
  }

  const root = options.spikesRoot.trim().replace(/\/+$/, "") || "/";
  const recorded = `${root === "/" ? "" : root}/${project}`;
  const expanded = expandHome(recorded, home);
  if (!expanded) {
    return { ok: false, code: 1, error: `spikes root must be absolute or start with ~: ${options.spikesRoot}` };
  }
  const path = resolve(expanded);

  // A write follows symlinks: refuse a project dir or repos.json that is one (or resolves
  // outside projectsDir) before reading it, so a planted link can never redirect the write.
  try {
    assertContainedDir(projectsDir, [project]);
  } catch (err) {
    return { ok: false, code: 1, error: (err as Error).message };
  }
  const reposPath = join(projectsDir, project, "repos.json");
  if (isDanglingLink(reposPath)) {
    return { ok: false, code: 1, error: `refusing a symlinked ${project}/repos.json` };
  }
  const entries = readEntries(reposPath);
  if (typeof entries === "string") return { ok: false, code: 1, error: entries };

  const exists = existsSync(path);
  if (exists && !statSync(path).isDirectory()) {
    return { ok: false, code: 1, error: `${path} exists and is not a directory` };
  }
  const isRepo = exists && existsSync(join(path, ".git"));
  if (exists && !isRepo && readdirSync(path).length > 0) {
    return {
      ok: false,
      code: 2,
      reason: "occupied",
      path,
      error: `${path} exists, is not empty and is not a git repo`,
    };
  }

  if (!isRepo) {
    if (!exists) mkdirSync(path, { recursive: true });
    try {
      execFileSync("git", ["init", "-q"], { cwd: path, env: gitEnv(), stdio: "pipe" });
    } catch (err) {
      if (!exists) rmSync(path, { recursive: true, force: true });
      return { ok: false, code: 1, error: `git init failed in ${path}: ${(err as Error).message}` };
    }
  }

  // Already registered when any entry names the same dir, however it is spelled.
  const listed = entries.some((e) => {
    const p = typeof e?.path === "string" ? expandHome(e.path, home) : null;
    return p !== null && resolve(p) === path;
  });
  if (!listed) {
    entries.push({ name: `${project}-spikes`, path: recorded });
    writeFileAtomic(reposPath, JSON.stringify(entries, null, 2) + "\n");
  }

  return { ok: true, path, repo: isRepo ? "existing" : "created", registered: !listed };
}
