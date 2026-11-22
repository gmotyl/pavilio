import { execFile } from "node:child_process";
import { basename } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import { type ChecksState, type PrProvider, PrUnavailableError, type PullRequest } from "./provider.js";

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

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

type CheckOutcome = "fail" | "pending" | "ok";

function checkOutcome(c: RawCheck): CheckOutcome {
  // StatusContext carries `state`; CheckRun carries `status` + `conclusion`.
  if (c.__typename === "StatusContext" || (c.state !== undefined && c.status === undefined)) {
    const s = (c.state ?? "").toUpperCase();
    if (FAILED.has(s)) return "fail";
    if (PENDING_STATES.has(s)) return "pending";
    return "ok";
  }
  if ((c.status ?? "").toUpperCase() !== "COMPLETED") return "pending";
  return FAILED.has((c.conclusion ?? "").toUpperCase()) ? "fail" : "ok";
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

export function createGitHubGhProvider(deps: { run?: Runner } = {}): PrProvider {
  const run = deps.run ?? defaultRunner;
  let login: Promise<string> | null = null;

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

  /** Returns `owner/repo` of origin; gh gets it via --repo, since in a fork clone gh defaults to upstream. */
  async function assertGitHub(repoPath: string): Promise<string> {
    let url: string;
    try {
      url = await git(["remote", "get-url", "origin"], repoPath);
    } catch {
      // No origin at all is just as un-GitHub as a foreign host.
      throw new PrUnavailableError("not-github", "no origin remote");
    }
    if (remoteHost(url) !== "github.com") throw new PrUnavailableError("not-github", `origin is ${url.trim()}`);
    const slug = remoteRepo(url);
    if (!slug) throw new PrUnavailableError("not-github", `cannot parse owner/repo from ${url.trim()}`);
    return slug;
  }

  return {
    whoami() {
      login ??= gh(["api", "user", "--jq", ".login"], process.cwd()).then((s) => s.trim());
      // A failed lookup must not poison the cache (e.g. user runs `gh auth login` later).
      login.catch(() => {
        login = null;
      });
      return login;
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
      if (!Number.isInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const slug = await assertGitHub(repoPath);
      const base = (
        await gh(["pr", "view", String(n), "--repo", slug, "--json", "baseRefName", "--jq", ".baseRefName"], repoPath)
      ).trim();
      if (!base) throw new PrUnavailableError("failed", `PR #${n} has no base branch`);
      const headRef = `refs/pavilio/pr/${n}`;
      const baseRef = `refs/remotes/origin/${base}`;
      // `+`: PR heads are force-pushed routinely; a stale local ref must not block the update.
      await git(["fetch", "--no-tags", "origin", `+pull/${n}/head:${headRef}`, `+refs/heads/${base}:${baseRef}`], repoPath);
      const head = (await git(["rev-parse", "--verify", `${headRef}^{commit}`], repoPath)).trim();
      const baseSha = (await git(["rev-parse", "--verify", `${baseRef}^{commit}`], repoPath)).trim();
      return { head, base: baseSha };
    },
  };
}
