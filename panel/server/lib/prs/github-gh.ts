import { basename } from "node:path";
import { GITHUB_REMOTE_HOSTS, remoteHost } from "./forge.js";
import {
  type ChecksState,
  type PrProvider,
  type PrState,
  PrUnavailableError,
  type PullRequest,
  type ReviewComment,
} from "./provider.js";
import { fetchPrRefs, runGit } from "./fetchPrRefs.js";
import { defaultRunner, type RunResult, type Runner } from "./run.js";

// Re-exported: the runner moved to run.ts; existing imports keep working.
export { defaultRunner, type RunResult, type Runner };

const PR_FIELDS =
  "number,title,author,isDraft,reviewRequests,reviewDecision,statusCheckRollup,headRefName,headRefOid,baseRefName,updatedAt,url";
// Older gh (e.g. 2.7) rejects the whole --json list over this one field.
const PR_FIELDS_NO_HEAD_OID = PR_FIELDS.replace(",headRefOid", "");
const UNKNOWN_HEAD_OID = /Unknown JSON field: "headRefOid"/;
// Per process: once gh said it lacks headRefOid, stop asking for it.
let headRefOidUnsupported = false;

export function __resetGhFieldSupportForTests(): void {
  headRefOidUnsupported = false;
}

// gh exits 4 when it needs `gh auth login`; older versions only say so on stderr.
const GH_AUTH_EXIT = 4;
const AUTH_ERROR = /gh auth login|not logged in|authentication required|HTTP 401|bad credentials/i;

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
  headRefOid?: string;
  baseRefName: string;
  updatedAt: string;
  url: string;
}

const COMMENT_FIELDS =
  ".[] | {id, in_reply_to_id, path, line, side, user: {login: .user.login}, body, created_at, html_url, commit_id}";

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
  commit_id: string;
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

function mapState(s: string | undefined): PrState {
  switch (s) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return "open";
  }
}

/** One mapper for `gh pr list` and `gh pr view` rows. */
function mapPr(p: RawPr, repoPath: string): PullRequest {
  return {
    repo: basename(repoPath),
    repoPath,
    number: p.number,
    title: p.title,
    author: p.author?.login ?? "",
    isDraft: Boolean(p.isDraft),
    // Team requests have no login; only individual users are reviewers here.
    reviewers: (p.reviewRequests ?? []).filter((r) => r.__typename === "User" && r.login).map((r) => r.login as string),
    reviewDecision: mapDecision(p.reviewDecision),
    checks: rollupChecks(p.statusCheckRollup),
    head: p.headRefName,
    headSha: p.headRefOid ?? "",
    base: p.baseRefName,
    updatedAt: p.updatedAt,
    url: p.url,
    forge: "github",
  };
}

// Re-exported: remoteHost moved to forge.ts; existing imports keep working.
export { remoteHost };

/** `owner/repo` of a GitHub remote URL, `.git` suffix dropped. */
export function remoteRepo(url: string): string | null {
  const u = url.trim();
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(u)?.[1] ?? /^(?:[^@/]+@)?[^/:]+:(?!\/\/)(.+)$/.exec(u)?.[1];
  const m = path ? /^\/*([^/]+)\/([^/]+?)(?:\.git)?\/*$/.exec(path) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

const GITHUB_HOST = "github.com";
// Re-read so `gh auth switch` shows up without a restart.
const LOGIN_TTL_MS = 5 * 60_000;

export function createGitHubGhProvider(
  deps: { run?: Runner; now?: () => number; forced?: (repoPath: string) => boolean } = {},
): PrProvider {
  const run = deps.run ?? defaultRunner;
  // A repos.json `forge: "github"` override: origin may sit on an SSH host alias.
  const forced = deps.forced ?? (() => false);
  const now = deps.now ?? Date.now;
  let login: { at: number; value: Promise<string> } | null = null;

  async function runGh(args: string[], cwd: string): Promise<RunResult> {
    try {
      return await run("gh", args, { cwd });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new PrUnavailableError("gh-missing", "gh not found");
      throw new PrUnavailableError("failed", (err as Error).message);
    }
  }

  function ghFailure(r: RunResult): PrUnavailableError {
    if (r.code === GH_AUTH_EXIT || AUTH_ERROR.test(r.stderr)) {
      return new PrUnavailableError("gh-unauthenticated", r.stderr.trim() || "gh is not authenticated");
    }
    return new PrUnavailableError("failed", r.stderr.trim() || `gh exited ${r.code}`);
  }

  async function gh(args: string[], cwd: string): Promise<string> {
    const r = await runGh(args, cwd);
    if (r.code === 0) return r.stdout;
    throw ghFailure(r);
  }

  /** Runs `args(fields)` with PR_FIELDS; on a gh that lacks headRefOid, once more without it. */
  async function ghPrFields(
    args: (fields: string, hasHeadOid: boolean) => string[],
    cwd: string,
  ): Promise<{ out: string; hasHeadOid: boolean }> {
    if (!headRefOidUnsupported) {
      const r = await runGh(args(PR_FIELDS, true), cwd);
      if (r.code === 0) return { out: r.stdout, hasHeadOid: true };
      if (!UNKNOWN_HEAD_OID.test(r.stderr)) throw ghFailure(r);
      headRefOidUnsupported = true;
    }
    return { out: await gh(args(PR_FIELDS_NO_HEAD_OID, false), cwd), hasHeadOid: false };
  }

  const git = (args: string[], cwd: string) => runGit(run, args, cwd);

  /**
   * Returns origin's gh --repo value and its `owner/repo`: in a fork clone gh defaults to
   * upstream, so --repo pins it. A real GitHub host is qualified `github.com/owner/repo`,
   * since an unqualified slug would resolve against GH_HOST; a forced override on another
   * host (e.g. an SSH alias gh does not know) passes the bare `owner/repo`.
   */
  async function assertGitHub(repoPath: string): Promise<{ repoArg: string; slug: string }> {
    let url: string;
    try {
      url = await git(["remote", "get-url", "origin"], repoPath);
    } catch {
      // No origin at all is just as un-GitHub as a foreign host.
      throw new PrUnavailableError("unknown-forge", "no origin remote");
    }
    const host = remoteHost(url) ?? "";
    const githubHost = GITHUB_REMOTE_HOSTS.has(host);
    // The host lets the copy name it.
    if (!githubHost && !forced(repoPath)) {
      throw new PrUnavailableError("unknown-forge", `origin is ${url.trim()}`, host || undefined);
    }
    const slug = remoteRepo(url);
    if (!slug) throw new PrUnavailableError("unknown-forge", `cannot parse owner/repo from ${url.trim()}`);
    // GitHub Enterprise stays unsupported: a forced alias host gets no --hostname / GH_HOST, so gh talks to github.com.
    return { repoArg: githubHost ? `${GITHUB_HOST}/${slug}` : slug, slug };
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
      const { repoArg } = await assertGitHub(repoPath);
      // Without headRefOid the rows carry headSha "", which the UI reads as unknown.
      const { out } = await ghPrFields(
        (fields) => ["pr", "list", "--repo", repoArg, "--state", "open", "--limit", "100", "--json", fields],
        repoPath,
      );
      let raw: RawPr[];
      try {
        raw = JSON.parse(out) as RawPr[];
      } catch {
        throw new PrUnavailableError("failed", "gh pr list returned invalid JSON");
      }
      if (!Array.isArray(raw)) throw new PrUnavailableError("failed", "gh pr list returned non-array JSON");
      return raw.map((p) => mapPr(p, repoPath));
    },

    async getPr(repoPath, n) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const { repoArg } = await assertGitHub(repoPath);
      // Without headRefOid, the head is the PR's last commit (`commits` lists all of them).
      const { out, hasHeadOid } = await ghPrFields(
        (fields, hasOid) => [
          "pr",
          "view",
          String(n),
          "--repo",
          repoArg,
          "--json",
          hasOid ? `${fields},state` : `${fields},state,commits`,
        ],
        repoPath,
      );
      let raw: RawPr & { state?: string; commits?: { oid?: string }[] | null };
      try {
        raw = JSON.parse(out) as typeof raw;
      } catch {
        throw new PrUnavailableError("failed", "gh pr view returned invalid JSON");
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new PrUnavailableError("failed", "gh pr view returned a non-object");
      }
      if (!hasHeadOid) raw = { ...raw, headRefOid: raw.commits?.at(-1)?.oid ?? "" };
      return { ...mapPr(raw, repoPath), state: mapState(raw.state) };
    },

    async openPr(repoPath, n) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const { repoArg } = await assertGitHub(repoPath);
      const view = JSON.parse(await gh(["pr", "view", String(n), "--repo", repoArg, "--json", "baseRefName,body"], repoPath)) as {
        baseRefName?: string;
        body?: string;
      };
      const base = (view.baseRefName ?? "").trim();
      if (!base) throw new PrUnavailableError("failed", `PR #${n} has no base branch`);
      const { head, base: baseSha } = await fetchPrRefs(run, repoPath, { n, headRefspecSource: `pull/${n}/head`, base });
      return { head, base: baseSha, body: view.body ?? "" };
    },

    async reviewComments(repoPath, n) {
      if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
      const { slug } = await assertGitHub(repoPath);
      // --jq '.[] | {...}' prints one object per line on every page, so pages concatenate without `][`.
      // Project only the consumed fields: whole objects repeat `diff_hunk` and can overflow the runner's maxBuffer.
      // --hostname: an inherited GH_HOST must not send this to another host once origin proved github.com.
      const out = await gh(
        ["api", "--hostname", GITHUB_HOST, "--paginate", `repos/${slug}/pulls/${n}/comments`, "--jq", COMMENT_FIELDS],
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
          commitId: c.commit_id,
        });
      }
      return comments;
    },
  };
}
