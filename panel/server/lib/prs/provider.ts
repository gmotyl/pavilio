export type ChecksState = "pass" | "fail" | "running" | "none";

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
  base: string;
  updatedAt: string;
  url: string;
}

export type Unavailable = "gh-missing" | "gh-unauthenticated" | "not-github" | "failed";

export interface PrProvider {
  whoami(): Promise<string>;
  listOpen(repoPath: string): Promise<PullRequest[]>;
  /** Fetches the PR's head and base into private refs; `body` is the PR description (markdown, "" when none). */
  openPr(repoPath: string, n: number): Promise<{ head: string; base: string; body: string }>;
}

/** Strip `user:secret@` from any URL in `text`: git and gh echo the origin URL in errors. */
export function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, "$1***@");
}

export class PrUnavailableError extends Error {
  readonly reason: Unavailable;

  constructor(reason: Unavailable, message: string = reason) {
    super(redactUrlCredentials(message));
    this.name = "PrUnavailableError";
    this.reason = reason;
  }
}
