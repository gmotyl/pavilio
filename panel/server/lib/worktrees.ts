import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
