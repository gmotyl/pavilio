import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gitSafeEnv } from "./gitEnv.js";

export interface RepoWorktree {
  path: string;
  /** Short branch name, or null for a detached HEAD. */
  branch: string | null;
  head: string;
}

const GIT_TIMEOUT_MS = 3000;

interface Stanza extends RepoWorktree {
  prunable: boolean;
}

/** Parse `git worktree list --porcelain` output into one record per stanza. */
function parsePorcelain(out: string): Stanza[] {
  const stanzas: Stanza[] = [];
  let cur: Stanza | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), branch: null, head: "", prunable: false };
      stanzas.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      cur.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line === "detached") {
      cur.branch = null;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      cur.prunable = true;
    }
  }
  return stanzas;
}

/** Linked worktrees of `repoPath`, excluding the main checkout, prunable and missing dirs. Never throws. */
export function listRepoWorktrees(repoPath: string): RepoWorktree[] {
  let out: string;
  try {
    // gitSafeEnv: an inherited GIT_DIR would otherwise beat `-C` and list the wrong repo.
    out = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
      encoding: "utf-8",
      env: gitSafeEnv(),
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(`[worktrees] git worktree list failed for ${repoPath}: ${msg}`);
    return [];
  }
  // The first stanza is always the main checkout.
  return parsePorcelain(out)
    .slice(1)
    .filter((w) => !w.prunable && existsSync(w.path))
    .map(({ path, branch, head }) => ({ path, branch, head }));
}

const CHANGE_ARTIFACTS = ["proposal.md", "design.md", "tasks.md"] as const;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Relative artifact paths of one change dir, sorted. Mirrors `readChangeArtifacts`
 * in routes/projects.ts: `proposal.md`, `design.md`, `tasks.md` and
 * `specs/<capability>/spec.md`. A missing or unreadable dir yields [].
 */
function changeArtifactPaths(changeDir: string): string[] {
  const out: string[] = CHANGE_ARTIFACTS.filter((name) => isFile(join(changeDir, name)));
  try {
    for (const cap of readdirSync(join(changeDir, "specs"), { withFileTypes: true })) {
      if (!cap.isDirectory()) continue;
      const rel = join("specs", cap.name, "spec.md");
      if (isFile(join(changeDir, rel))) out.push(rel);
    }
  } catch {
    // No (readable) specs dir: no delta specs.
  }
  return out.sort();
}

/** True when the artifact sets differ or any same-named artifact's bytes differ. */
function changeDiffers(wtChangeDir: string, mainChangeDir: string): boolean {
  if (!isDir(mainChangeDir)) return true;
  const wtPaths = changeArtifactPaths(wtChangeDir);
  const mainPaths = changeArtifactPaths(mainChangeDir);
  if (wtPaths.length !== mainPaths.length || wtPaths.some((p, i) => p !== mainPaths[i])) return true;
  for (const rel of wtPaths) {
    try {
      if (!readFileSync(join(wtChangeDir, rel)).equals(readFileSync(join(mainChangeDir, rel)))) return true;
    } catch {
      // Unreadable on either side: flag it, so a worktree edit is never silently hidden.
      return true;
    }
  }
  return false;
}

/**
 * Active (non-archive) change ids under `<worktreeOpenspec>/changes/` that differ from `<mainOpenspec>/changes/`.
 *
 * Never throws. Error policy: a missing or unreadable worktree `changes/` dir yields an
 * empty set (nothing to show); a missing main change dir or an unreadable artifact on
 * either side counts as "differs" (better to show a duplicate than hide worktree work).
 */
export function diffActiveChanges(worktreeOpenspecDir: string, mainOpenspecDir: string): Set<string> {
  const result = new Set<string>();
  const wtChanges = join(worktreeOpenspecDir, "changes");
  const mainChanges = join(mainOpenspecDir, "changes");
  let entries;
  try {
    entries = readdirSync(wtChanges, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "archive") continue;
    if (changeDiffers(join(wtChanges, e.name), join(mainChanges, e.name))) result.add(e.name);
  }
  return result;
}
