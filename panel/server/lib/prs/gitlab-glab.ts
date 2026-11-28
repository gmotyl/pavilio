import { basename } from "node:path";
import type { ResolvedForge } from "./forge.js";
import { type ChecksState, type PrProvider, type PrState, PrUnavailableError, type PullRequest } from "./provider.js";
import { defaultRunner, type RunResult, type Runner } from "./run.js";

const MR_FIELDS =
  "iid title draft author { username } reviewers { nodes { username mergeRequestInteraction { reviewState } } } approved approvalsLeft headPipeline { status } sourceBranch targetBranch diffHeadSha updatedAt webUrl";

const LIST_QUERY = `query($path: ID!) { project(fullPath: $path) { mergeRequests(state: opened, first: 100, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } } } }`;
const ONE_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { ${MR_FIELDS} state description } } }`;

interface RawMr {
  iid: string;
  title: string;
  draft: boolean;
  author?: { username?: string } | null;
  reviewers?: { nodes?: ({ username?: string; mergeRequestInteraction?: { reviewState?: string } | null } | null)[] | null } | null;
  approved?: boolean | null;
  approvalsLeft?: number | null;
  headPipeline?: { status?: string } | null;
  sourceBranch: string;
  targetBranch: string;
  diffHeadSha?: string | null;
  updatedAt: string;
  webUrl: string;
  state?: string;
  description?: string | null;
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

function mapMr(m: RawMr, repoPath: string): PullRequest {
  const reviewers = reviewStates(m);
  // Pending requests, like GitHub's reviewRequests.
  const pending = reviewers.filter((r) => r.state === "UNREVIEWED").map((r) => r.username);
  const reviewDecision: PullRequest["reviewDecision"] = reviewers.some((r) => r.state === "REQUESTED_CHANGES")
    ? "changes"
    : m.approved
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
  if (!Number.isSafeInteger(n) || n <= 0) throw new PrUnavailableError("failed", `invalid MR number ${n}`);
};

export function createGitLabGlabProvider(deps: {
  run?: Runner;
  resolve: (repoPath: string) => Promise<ResolvedForge>;
}): Omit<PrProvider, "whoami"> & { whoami(): Promise<string> } {
  const run = deps.run ?? defaultRunner;

  async function target(repoPath: string): Promise<{ host: string; projectPath: string }> {
    const r = await deps.resolve(repoPath);
    if (r.forge !== "gitlab") throw new PrUnavailableError("unknown-forge", `origin is not GitLab (${r.host})`, r.host);
    return { host: r.host, projectPath: r.projectPath };
  }

  // Error classification (glab-missing / glab-unauthenticated) lands in Task 5; everything is `failed` for now.
  async function graphql(repoPath: string, host: string, vars: string[]): Promise<unknown> {
    let r: RunResult;
    try {
      // --hostname: an inherited GITLAB_HOST must not redirect the call.
      r = await run("glab", ["api", "graphql", "--hostname", host, ...vars], { cwd: repoPath });
    } catch (err) {
      throw new PrUnavailableError("failed", (err as Error).message, host);
    }
    if (r.code !== 0) throw new PrUnavailableError("failed", r.stderr.trim() || `glab exited ${r.code}`, host);
    let doc: { data?: { project?: unknown } | null; errors?: unknown };
    try {
      doc = JSON.parse(r.stdout) as typeof doc;
    } catch {
      throw new PrUnavailableError("failed", "glab api graphql returned invalid JSON", host);
    }
    if (!doc || typeof doc !== "object" || doc.errors) {
      throw new PrUnavailableError("failed", "glab api graphql returned errors", host);
    }
    const project = doc.data?.project;
    if (!project || typeof project !== "object") throw new PrUnavailableError("failed", "GitLab project not found", host);
    return project;
  }

  return {
    // Identity comes from gh; GitLab rows never need it.
    async whoami() {
      return "";
    },

    async listOpen(repoPath) {
      const { host, projectPath } = await target(repoPath);
      const project = (await graphql(repoPath, host, ["-f", `query=${LIST_QUERY}`, "-F", `path=${projectPath}`])) as {
        mergeRequests?: { nodes?: RawMr[] | null } | null;
      };
      const nodes = project.mergeRequests?.nodes;
      if (!Array.isArray(nodes)) throw new PrUnavailableError("failed", "glab api graphql returned no merge requests", host);
      return nodes.map((m) => mapMr(m, repoPath));
    },

    async getPr(repoPath, n) {
      assertNumber(n);
      const { host, projectPath } = await target(repoPath);
      // iid is a GraphQL String: -f keeps it a string where -F would send a number.
      const project = (await graphql(repoPath, host, [
        "-f",
        `query=${ONE_QUERY}`,
        "-F",
        `path=${projectPath}`,
        "-f",
        `iid=${n}`,
      ])) as { mergeRequest?: RawMr | null };
      const m = project.mergeRequest;
      if (!m || typeof m !== "object") throw new PrUnavailableError("failed", `MR !${n} not found`, host);
      return { ...mapMr(m, repoPath), state: mapState(m.state) };
    },

    // Task 5: refs fetch via fetchPrRefs.
    async openPr(_repoPath, n) {
      assertNumber(n);
      throw new PrUnavailableError("failed", "GitLab openPr is not implemented yet");
    },

    // Task 5: discussions → review comments.
    async reviewComments(_repoPath, n) {
      assertNumber(n);
      throw new PrUnavailableError("failed", "GitLab reviewComments is not implemented yet");
    },
  };
}
