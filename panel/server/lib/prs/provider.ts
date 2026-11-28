export type ChecksState = "pass" | "fail" | "running" | "none";

export type PrState = "open" | "merged" | "closed";

/** The code host a repo's PRs live on: GitHub (`gh`) or GitLab (`glab`). */
export type Forge = "github" | "gitlab";

export interface PullRequest {
  repo: string;
  repoPath: string;
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  reviewers: string[];
  reviewDecision: "approved" | "changes" | "required" | null;
  checks: ChecksState;
  head: string;
  /** Head commit SHA (GitHub `headRefOid`). */
  headSha: string;
  base: string;
  updatedAt: string;
  url: string;
  forge: Forge;
}

/** An inline review comment on a PR diff line; `side` "old" is the base side, "new" the head side. */
export interface ReviewComment {
  id: number;
  replyTo: number | null;
  path: string;
  line: number;
  side: "old" | "new";
  author: string;
  body: string;
  createdAt: string;
  url: string;
  /** Head commit `line` refers to (GitHub `commit_id`); a different SHA than the viewed head means stale line numbers. */
  commitId: string;
}

export type Unavailable =
  | "gh-missing"
  | "gh-unauthenticated"
  | "glab-missing"
  | "glab-unauthenticated"
  | "unknown-forge"
  | "failed";

export interface PrProvider {
  whoami(): Promise<string>;
  listOpen(repoPath: string): Promise<PullRequest[]>;
  /** One PR in any state (open, merged or closed). */
  getPr(repoPath: string, n: number): Promise<PullRequest & { state: PrState }>;
  /** Fetches the PR's head and base into private refs; `body` is the PR description (markdown, "" when none). */
  openPr(repoPath: string, n: number): Promise<{ head: string; base: string; body: string }>;
  /** Inline review comments still anchored to a diff line; outdated ones are dropped. */
  reviewComments(repoPath: string, n: number): Promise<ReviewComment[]>;
}

/** Strip `user:secret@` from any URL in `text`: git and gh echo the origin URL in errors. */
export function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, "$1***@");
}

export class PrUnavailableError extends Error {
  readonly reason: Unavailable;
  /** The remote host the reason applies to (e.g. a self-hosted GitLab), when known. */
  readonly host?: string;

  constructor(reason: Unavailable, message: string = reason, host?: string) {
    super(redactUrlCredentials(message));
    this.name = "PrUnavailableError";
    this.reason = reason;
    if (host !== undefined) this.host = host;
  }
}
