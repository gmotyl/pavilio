import { PrUnavailableError } from "./provider.js";
import { GIT_ENV, type RunResult, type Runner } from "./run.js";

/** The raw runner; git runs through it with GIT_ENV. */
export type GitRunner = Runner;

// Shallow clones: up to DEEPEN_ROUNDS × DEEPEN_BY extra commits per side before giving up.
const DEEPEN_ROUNDS = 5;
const DEEPEN_BY = 200;

/** Runs git in `cwd`; any non-zero exit becomes a `failed` PrUnavailableError. */
export async function runGit(run: GitRunner, args: string[], cwd: string): Promise<string> {
  let r: RunResult;
  try {
    r = await run("git", args, { cwd, env: GIT_ENV });
  } catch (err) {
    throw new PrUnavailableError("failed", (err as Error).message);
  }
  if (r.code !== 0) throw new PrUnavailableError("failed", r.stderr.trim() || `git ${args[0]} exited ${r.code}`);
  return r.stdout;
}

/** merge-base exits 1 when the two commits share no ancestor in this clone. */
async function hasMergeBase(run: GitRunner, a: string, b: string, cwd: string): Promise<boolean> {
  let r: RunResult;
  try {
    r = await run("git", ["merge-base", a, b], { cwd, env: GIT_ENV });
  } catch (err) {
    throw new PrUnavailableError("failed", (err as Error).message);
  }
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new PrUnavailableError("failed", r.stderr.trim() || `git merge-base exited ${r.code}`);
}

/**
 * Fetches a PR/MR head and its base branch into refs/pavilio/pr{,-base}/<n> and returns both SHAs.
 * headRefspecSource: "pull/<n>/head" (GitHub) | "refs/merge-requests/<n>/head" (GitLab).
 */
export async function fetchPrRefs(
  git: GitRunner,
  repoPath: string,
  opts: { n: number; headRefspecSource: string; base: string },
): Promise<{ head: string; base: string }> {
  const { n, headRefspecSource, base } = opts;
  const headRef = `refs/pavilio/pr/${n}`;
  const baseRef = `refs/pavilio/pr-base/${n}`;
  // Touch only refs/pavilio/: --refmap= skips the opportunistic origin/* update,
  // no FETCH_HEAD, no submodule fetches. `+`: PR heads are force-pushed routinely.
  const fetch = (extra: string[]) =>
    runGit(
      git,
      [
        "fetch",
        ...extra,
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--refmap=",
        "origin",
        `+${headRefspecSource}:${headRef}`,
        `+refs/heads/${base}:${baseRef}`,
      ],
      repoPath,
    );
  await fetch([]);
  const head = (await runGit(git, ["rev-parse", "--verify", `${headRef}^{commit}`], repoPath)).trim();
  const baseSha = (await runGit(git, ["rev-parse", "--verify", `${baseRef}^{commit}`], repoPath)).trim();
  // A shallow clone may lack the shared ancestor the review diffs against: deepen, bounded.
  if ((await runGit(git, ["rev-parse", "--is-shallow-repository"], repoPath)).trim() === "true") {
    for (let round = 0; round < DEEPEN_ROUNDS && !(await hasMergeBase(git, baseSha, head, repoPath)); round++) {
      await fetch([`--deepen=${DEEPEN_BY}`]);
    }
  }
  return { head, base: baseSha };
}
