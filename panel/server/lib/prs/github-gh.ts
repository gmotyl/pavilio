import { execFile } from "node:child_process";
import { basename } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import {
  type ChecksState,
  type PrProvider,
  PrUnavailableError,
  type PullRequest,
  type ReviewComment,
} from "./provider.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves with the exit code for any exit; rejects only when the process could not start (e.g. ENOENT). */
export type Runner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
) => Promise<RunResult>;

const TIMEOUT_MS = 30_000;
// Shallow clones: up to DEEPEN_ROUNDS × DEEPEN_BY extra commits per side before giving up.
const DEEPEN_ROUNDS = 5;
const DEEPEN_BY = 200;
const PR_FIELDS =
  "number,title,author,isDraft,reviewRequests,reviewDecision,statusCheckRollup,headRefName,baseRefName,updatedAt,url";
// gh exits 4 when it needs `gh auth login`; older versions only say so on stderr.
const GH_AUTH_EXIT = 4;
const AUTH_ERROR = /gh auth login|not logged in|authentication required|HTTP 401|bad credentials/i;

export const defaultRunner: Runner = (cmd, args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    // gitSafeEnv: an inherited GIT_DIR would retarget git (and gh's git calls) away from `cwd`.
    execFile(
      cmd,
      args,
      { cwd, env: { ...gitSafeEnv(), ...env }, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf-8" },
      (err, stdout, stderr) => {
        if (err && typeof err.code === "string") return reject(err);
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });

interface RawCheck {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}

interface RawPr {
  number: number;
  title: string;
  author?: { login?: string } | null;
  isDraft: boolean;
  reviewRequests?: { __typename?: string; login?: string }[] | null;
  reviewDecision?: string | null;
  statusCheckRollup?: RawCheck[] | null;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  url: string;
}

interface RawReviewComment {
  id: number;
  in_reply_to_id?: number | null;
  path: string;
  line: number | null;
  side?: string | null;
  user?: { login?: string } | null;
  body?: string | null;
  created_at: string;
  html_url: string;
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
// Only these count as passed; STALE or any unknown value is not green.
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

type CheckOutcome = "fail" | "pending" | "ok";

function checkOutcome(c: RawCheck): CheckOutcome {
  // StatusContext carries `state`; CheckRun carries `status` + `conclusion`.
  if (c.__typename === "StatusContext" || (c.state !== undefined && c.status === undefined)) {
    const s = (c.state ?? "").toUpperCase();
    return FAILED.has(s) ? "fail" : PASSED.has(s) ? "ok" : "pending";
  }
  if ((c.status ?? "").toUpperCase() !== "COMPLETED") return "pending";
  const conclusion = (c.conclusion ?? "").toUpperCase();
  return FAILED.has(conclusion) ? "fail" : PASSED.has(conclusion) ? "ok" : "pending";
}

/** Any failure → fail, else any pending → running, else pass; no checks → none. */
export function rollupChecks(checks: RawCheck[] | null | undefined): ChecksState {
  if (!checks || checks.length === 0) return "none";
  const outcomes = checks.map(checkOutcome);
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("pending")) return "running";
  return "pass";
}

function mapDecision(d: string | null | undefined): PullRequest["reviewDecision"] {
  switch (d) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes";
    case "REVIEW_REQUIRED":
      return "required";
    default:
      return null;
  }
}

/** Host of a git remote URL: https://, ssh://, git:// or scp-style `user@host:path`. */
export function remoteHost(url: string): string | null {
  const u = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(u);
  if (scheme) return scheme[1].toLowerCase();
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)/.exec(u);
  return scp ? scp[1].toLowerCase() : null;
}

/** `owner/repo` of a GitHub remote URL, `.git` suffix dropped. */
export function remoteRepo(url: string): string | null {
  const u = url.trim();
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(u)?.[1] ?? /^(?:[^@/]+@)?[^/:]+:(?!\/\/)(.+)$/.exec(u)?.[1];
  const m = path ? /^\/*([^/]+)\/([^/]+?)(?:\.git)?\/*$/.exec(path) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

// A credential prompt would hang the request until the timeout; fail fast instead.
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };
const GITHUB_HOST = "github.com";
// GitHub's SSH-over-443 endpoint is the same github.com.
const GITHUB_REMOTE_HOSTS = new Set([GITHUB_HOST, "ssh.github.com"]);
// Re-read so `gh auth switch` shows up without a restart.
const LOGIN_TTL_MS = 5 * 60_000;

export function createGitHubGhProvider(deps: { run?: Runner; now?: () => number } = {}): PrProvider {
  const run = deps.run ?? defaultRunner;
  const now = deps.now ?? Date.now;
  let login: { at: number; value: Promise<string> } | null = null;

  async function gh(args: string[], cwd: string): Promise<string> {
    let r: RunResult;
    try {
      r = await run("gh", args, { cwd });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new PrUnavailableError("gh-missing", "gh not found");
      throw new PrUnavailableError("failed", (err as Error).message);
    }
    if (r.code === 0) return r.stdout;
    if (r.code === GH_AUTH_EXIT || AUTH_ERROR.test(r.stderr)) {
      throw new PrUnavailableError("gh-unauthenticated", r.stderr.trim() || "gh is not authenticated");
    }
    throw new PrUnavailableError("failed", r.stderr.trim() || `gh exited ${r.code}`);
  }

  async function git(args: string[], cwd: string): Promise<string> {
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
  async function hasMergeBase(a: string, b: string, cwd: string): Promise<boolean> {
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
   * Returns `github.com/owner/repo` of origin for gh's --repo: in a fork clone gh defaults
   * to upstream, and an unqualified slug would resolve against GH_HOST.
   */
  async function assertGitHub(repoPath: string): Promise<string> {
    let url: string;
    try {
      url = await git(["remote", "get-url", "origin"], repoPath);
    } catch {
      // No origin at all is just as un-GitHub as a foreign host.
      throw new PrUnavailableError("not-github", "no origin remote");
    }
    if (!GITHUB_REMOTE_HOSTS.has(remoteHost(url) ?? "")) throw new PrUnavailableError("not-github", `origin is ${url.trim()}`);
    const slug = remoteRepo(url);
    if (!slug) throw new PrUnavailableError("not-github", `cannot parse owner/repo from ${url.trim()}`);
    return `${GITHUB_HOST}/${slug}`;
  }

  return {
    whoami() {
      if (login && now() - login.at < LOGIN_TTL_MS) return login.value;
      const entry = {
        at: now(),
        value: gh(["api", "user", "--hostname", GITHUB_HOST, "--jq", ".login"], process.cwd()).then((s) => s.trim()),
      };
      login = entry;
      // A failed lookup must not poison the cache (e.g. user runs `gh auth login` later).
      entry.value.catch(() => {
        if (login === entry) login = null;
      });
      return entry.value;
    },

    async listOpen(repoPath) {
      const slug = await assertGitHub(repoPath);
      const out = await gh(
        ["pr", "list", "--repo", slug, "--state", "open", "--limit", "100", "--json", PR_FIELDS],
        repoPath,
      );
      let raw: RawPr[];
      try {
        raw = JSON.parse(out) as RawPr[];
      } catch {
        throw new PrUnavailableError("failed", "gh pr list returned invalid JSON");
      }
      if (!Array.isArray(raw)) throw new PrUnavailableError("failed", "gh pr list returned non-array JSON");
      const repo = basename(repoPath);
      return raw.map(
        (p): PullRequest => ({
          repo,
          repoPath,
          number: p.number,
          title: p.title,
          author: p.author?.login ?? "",
          isDraft: Boolean(p.isDraft),
          // Team requests have no login; only individual users are reviewers here.
          reviewers: (p.reviewRequests ?? [])
            .filter((r) => r.__typename === "User" && r.login)
            .map((r) => r.login as string),
          reviewDecision: mapDecision(p.reviewDecision),
          checks: rollupChecks(p.statusCheckRollup),
          head: p.headRefName,
          base: p.baseRefName,
          updatedAt: p.updatedAt,
          url: p.url,
        }),
      );
    },

    async openPr(repoPath, n) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const slug = await assertGitHub(repoPath);
      const view = JSON.parse(await gh(["pr", "view", String(n), "--repo", slug, "--json", "baseRefName,body"], repoPath)) as {
        baseRefName?: string;
        body?: string;
      };
      const base = (view.baseRefName ?? "").trim();
      if (!base) throw new PrUnavailableError("failed", `PR #${n} has no base branch`);
      const headRef = `refs/pavilio/pr/${n}`;
      const baseRef = `refs/pavilio/pr-base/${n}`;
      // Touch only refs/pavilio/: --refmap= skips the opportunistic origin/* update,
      // no FETCH_HEAD, no submodule fetches. `+`: PR heads are force-pushed routinely.
      const fetch = (extra: string[]) =>
        git(
          [
            "fetch",
            ...extra,
            "--no-tags",
            "--no-write-fetch-head",
            "--recurse-submodules=no",
            "--refmap=",
            "origin",
            `+pull/${n}/head:${headRef}`,
            `+refs/heads/${base}:${baseRef}`,
          ],
          repoPath,
        );
      await fetch([]);
      const head = (await git(["rev-parse", "--verify", `${headRef}^{commit}`], repoPath)).trim();
      const baseSha = (await git(["rev-parse", "--verify", `${baseRef}^{commit}`], repoPath)).trim();
      // A shallow clone may lack the shared ancestor the review diffs against: deepen, bounded.
      if ((await git(["rev-parse", "--is-shallow-repository"], repoPath)).trim() === "true") {
        for (let round = 0; round < DEEPEN_ROUNDS && !(await hasMergeBase(baseSha, head, repoPath)); round++) {
          await fetch([`--deepen=${DEEPEN_BY}`]);
        }
      }
      return { head, base: baseSha, body: view.body ?? "" };
    },

    async reviewComments(repoPath, n) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const slug = (await assertGitHub(repoPath)).slice(`${GITHUB_HOST}/`.length);
      // --jq '.[]' prints one object per line on every page, so pages concatenate without `][`.
      // --hostname: an inherited GH_HOST must not send this to another host once origin proved github.com.
      const out = await gh(
        ["api", "--hostname", GITHUB_HOST, "--paginate", `repos/${slug}/pulls/${n}/comments`, "--jq", ".[]"],
        repoPath,
      );
      const comments: ReviewComment[] = [];
      for (const text of out.split("\n")) {
        if (!text.trim()) continue;
        let c: RawReviewComment;
        try {
          c = JSON.parse(text) as RawReviewComment;
        } catch {
          throw new PrUnavailableError("failed", "gh api returned invalid JSON");
        }
        if (typeof c !== "object" || c === null || Array.isArray(c)) {
          throw new PrUnavailableError("failed", "gh api returned a non-object comment");
        }
        // line is null once the commented code is gone from the PR (outdated).
        if (c.line == null) continue;
        comments.push({
          id: c.id,
          replyTo: c.in_reply_to_id ?? null,
          path: c.path,
          line: c.line,
          side: c.side === "LEFT" ? "old" : "new",
          author: c.user?.login ?? "",
          body: c.body ?? "",
          createdAt: c.created_at,
          url: c.html_url,
        });
      }
      return comments;
    },
  };
}
