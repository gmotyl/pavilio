import { basename } from "node:path";
import { fetchPrRefs } from "./fetchPrRefs.js";
import type { ResolvedForge } from "./forge.js";
import {
  type ChecksState,
  type PrProvider,
  type PrState,
  PrUnavailableError,
  type PullRequest,
  type ReviewComment,
} from "./provider.js";
import { defaultRunner, type RunResult, type Runner } from "./run.js";

const MR_FIELDS =
  "iid title draft author { username } reviewers { nodes { username mergeRequestInteraction { reviewState } } } approved approvalsLeft approvalsRequired approvedBy { nodes { username } } headPipeline { status } sourceBranch targetBranch diffHeadSha updatedAt webUrl";

const LIST_QUERY = `query($path: ID!) { project(fullPath: $path) { mergeRequests(state: opened, first: 100, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } } } }`;
const ONE_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { ${MR_FIELDS} state description } } }`;
const WEB_URL_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { webUrl } } }`;

interface RawMr {
  iid: string;
  title: string;
  draft: boolean;
  author?: { username?: string } | null;
  reviewers?: { nodes?: ({ username?: string; mergeRequestInteraction?: { reviewState?: string } | null } | null)[] | null } | null;
  approved?: boolean | null;
  approvalsLeft?: number | null;
  approvalsRequired?: number | null;
  approvedBy?: { nodes?: ({ username?: string } | null)[] | null } | null;
  headPipeline?: { status?: string } | null;
  sourceBranch: string;
  targetBranch: string;
  diffHeadSha?: string | null;
  updatedAt: string;
  webUrl: string;
  state?: string;
  description?: string | null;
}

interface RawNote {
  id: number;
  type?: string | null;
  body?: string | null;
  author?: { username?: string } | null;
  created_at: string;
  position?: { new_path?: string; new_line?: number | null; old_line?: number | null; head_sha?: string } | null;
}

interface RawDiscussion {
  notes?: (RawNote | null)[] | null;
}

// glab exits non-zero with one of these on stderr when the host has no (valid) token.
// 401 counts only as an HTTP status, never as a number inside a path (e.g. MR !401).
const AUTH_ERROR = /HTTP\s*401|\b401\s+Unauthorized|glab auth login|not authenticated/i;

/**
 * Splits `glab --paginate` output into its top-level JSON values: pages are concatenated
 * as `[...][...]`, and `][` may also occur inside a string, so scan with string awareness.
 */
export function parseConcatenatedJson(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "]" || ch === "}") {
      if (--depth === 0) out.push(JSON.parse(text.slice(start, i + 1)));
      if (depth < 0) throw new SyntaxError("unbalanced JSON");
    } else if (depth === 0 && !/\s/.test(ch)) {
      throw new SyntaxError("unexpected text between JSON values");
    }
  }
  if (depth !== 0 || inString) throw new SyntaxError("truncated JSON");
  return out;
}

// Only these count as passed; any other (or unknown) status is not green.
const PASSED = new Set(["SUCCESS", "SKIPPED"]);
const FAILED = new Set(["FAILED", "CANCELED"]);

function mapChecks(p: RawMr["headPipeline"]): ChecksState {
  if (!p) return "none";
  const s = (p.status ?? "").toUpperCase();
  return PASSED.has(s) ? "pass" : FAILED.has(s) ? "fail" : "running";
}

function reviewStates(m: RawMr): { username: string; state: string }[] {
  return (m.reviewers?.nodes ?? []).flatMap((r) =>
    r?.username ? [{ username: r.username, state: r.mergeRequestInteraction?.reviewState ?? "" }] : [],
  );
}

function mapState(s: string | undefined): PrState {
  switch (s) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    default:
      // opened and locked are both still open.
      return "open";
  }
}

/** GitLab sets `approved` on any MR that needs no approval; count it only with a real approval or required rules. */
function isApproved(m: RawMr): boolean {
  const approvals = (m.approvedBy?.nodes ?? []).filter(Boolean).length;
  return Boolean(m.approved) && (approvals > 0 || (m.approvalsRequired ?? 0) > 0);
}

function mapMr(m: RawMr, repoPath: string): PullRequest {
  const reviewers = reviewStates(m);
  // Pending requests, like GitHub's reviewRequests.
  const pending = reviewers.filter((r) => r.state === "UNREVIEWED").map((r) => r.username);
  const reviewDecision: PullRequest["reviewDecision"] = reviewers.some((r) => r.state === "REQUESTED_CHANGES")
    ? "changes"
    : isApproved(m)
      ? "approved"
      : (m.approvalsLeft ?? 0) > 0 || pending.length > 0
        ? "required"
        : null;
  return {
    repo: basename(repoPath),
    repoPath,
    number: Number(m.iid),
    title: m.title,
    author: m.author?.username ?? "",
    isDraft: Boolean(m.draft),
    reviewers: pending,
    reviewDecision,
    checks: mapChecks(m.headPipeline),
    head: m.sourceBranch,
    headSha: m.diffHeadSha ?? "",
    base: m.targetBranch,
    updatedAt: m.updatedAt,
    url: m.webUrl,
    forge: "gitlab",
  };
}

const assertNumber = (n: number) => {
  if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid PR number ${n}`);
};

export function createGitLabGlabProvider(deps: {
  run?: Runner;
  resolve: (repoPath: string) => Promise<ResolvedForge>;
}): Omit<PrProvider, "whoami"> & { whoami(): Promise<string> } {
  const run = deps.run ?? defaultRunner;

  function glabFailure(r: RunResult, host: string): PrUnavailableError {
    const msg = r.stderr.trim() || `glab exited ${r.code}`;
    return new PrUnavailableError(AUTH_ERROR.test(r.stderr) ? "glab-unauthenticated" : "failed", msg, host);
  }

  async function target(repoPath: string): Promise<{ host: string; projectPath: string }> {
    const r = await deps.resolve(repoPath);
    if (r.forge !== "gitlab") throw new PrUnavailableError("unknown-forge", `origin is not GitLab (${r.host})`, r.host);
    return { host: r.host, projectPath: r.projectPath };
  }

  async function runGlab(args: string[], cwd: string, host: string): Promise<string> {
    let r: RunResult;
    try {
      r = await run("glab", args, { cwd });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new PrUnavailableError("glab-missing", "glab not found", host);
      throw new PrUnavailableError("failed", (err as Error).message, host);
    }
    if (r.code !== 0) throw glabFailure(r, host);
    return r.stdout;
  }

  async function graphql(repoPath: string, host: string, vars: string[]): Promise<unknown> {
    // --hostname: an inherited GITLAB_HOST must not redirect the call.
    const stdout = await runGlab(["api", "graphql", "--hostname", host, ...vars], repoPath, host);
    let doc: { data?: { project?: unknown } | null; errors?: unknown[] };
    try {
      doc = JSON.parse(stdout) as typeof doc;
    } catch {
      throw new PrUnavailableError("failed", "glab api graphql returned invalid JSON", host);
    }
    if (!doc || typeof doc !== "object") throw new PrUnavailableError("failed", "glab api graphql returned no object", host);
    // GitLab may send `errors: []` alongside data; only a non-empty list is a failure.
    if (Array.isArray(doc.errors) && doc.errors.length > 0) {
      const first = (doc.errors[0] as { message?: unknown } | null)?.message;
      throw new PrUnavailableError("failed", `glab api graphql returned errors${typeof first === "string" ? `: ${first}` : ""}`, host);
    }
    const project = doc.data?.project;
    if (!project || typeof project !== "object") throw new PrUnavailableError("failed", "GitLab project not found", host);
    return project;
  }

  async function oneMr(repoPath: string, n: number): Promise<{ m: RawMr; host: string }> {
    const { host, projectPath } = await target(repoPath);
    // -f sends raw strings: -F would send iid as a number and read an `@`-prefixed path from a file.
    const project = (await graphql(repoPath, host, [
      "-f",
      `query=${ONE_QUERY}`,
      "-f",
      `path=${projectPath}`,
      "-f",
      `iid=${n}`,
    ])) as { mergeRequest?: RawMr | null };
    const m = project.mergeRequest;
    if (!m || typeof m !== "object") throw new PrUnavailableError("failed", `PR !${n} not found`, host);
    return { m, host };
  }

  return {
    // Identity comes from gh; GitLab rows never need it.
    async whoami() {
      return "";
    },

    async listOpen(repoPath) {
      const { host, projectPath } = await target(repoPath);
      const project = (await graphql(repoPath, host, ["-f", `query=${LIST_QUERY}`, "-f", `path=${projectPath}`])) as {
        mergeRequests?: { nodes?: RawMr[] | null } | null;
      };
      const nodes = project.mergeRequests?.nodes;
      if (!Array.isArray(nodes)) throw new PrUnavailableError("failed", "glab api graphql returned no merge requests", host);
      return nodes.map((m) => mapMr(m, repoPath));
    },

    async getPr(repoPath, n) {
      assertNumber(n);
      const { m } = await oneMr(repoPath, n);
      return { ...mapMr(m, repoPath), state: mapState(m.state) };
    },

    async openPr(repoPath, n) {
      assertNumber(n);
      const { m, host } = await oneMr(repoPath, n);
      const base = (m.targetBranch ?? "").trim();
      if (!base) throw new PrUnavailableError("failed", `PR !${n} has no target branch`, host);
      const { head, base: baseSha } = await fetchPrRefs(run, repoPath, {
        n,
        headRefspecSource: `refs/merge-requests/${n}/head`,
        base,
      });
      return { head, base: baseSha, body: m.description ?? "" };
    },

    async reviewComments(repoPath, n) {
      assertNumber(n);
      const { host, projectPath } = await target(repoPath);
      // The discussions API carries no MR URL, and host + path would miss a relative URL root.
      const [project, stdout] = await Promise.all([
        graphql(repoPath, host, ["-f", `query=${WEB_URL_QUERY}`, "-f", `path=${projectPath}`, "-f", `iid=${n}`]) as Promise<{
          mergeRequest?: { webUrl?: unknown } | null;
        }>,
        runGlab(
          ["api", "--hostname", host, "--paginate", `projects/${encodeURIComponent(projectPath)}/merge_requests/${n}/discussions`],
          repoPath,
          host,
        ),
      ]);
      const webUrl = project.mergeRequest?.webUrl;
      if (typeof webUrl !== "string" || !webUrl) throw new PrUnavailableError("failed", `PR !${n} not found`, host);
      let pages: unknown[];
      try {
        pages = parseConcatenatedJson(stdout);
      } catch {
        throw new PrUnavailableError("failed", "glab api returned invalid JSON", host);
      }
      if (!pages.every(Array.isArray)) throw new PrUnavailableError("failed", "glab api returned a non-array page", host);
      const comments: ReviewComment[] = [];
      for (const d of (pages as RawDiscussion[][]).flat()) {
        const notes = (d?.notes ?? []).filter((x): x is RawNote => Boolean(x));
        const firstId = notes[0]?.id ?? null;
        for (const note of notes) {
          const pos = note.position;
          if (note.type !== "DiffNote" || !pos) continue;
          const side = pos.new_line != null ? "new" : pos.old_line != null ? "old" : null;
          if (!side) continue;
          comments.push({
            id: note.id,
            replyTo: note.id === firstId ? null : firstId,
            path: pos.new_path ?? "",
            line: (side === "new" ? pos.new_line : pos.old_line) as number,
            side,
            author: note.author?.username ?? "",
            body: note.body ?? "",
            createdAt: note.created_at,
            url: `${webUrl}#note_${note.id}`,
            commitId: pos.head_sha ?? "",
          });
        }
      }
      return comments;
    },
  };
}
