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
  openPr(repoPath: string, n: number): Promise<{ head: string; base: string }>;
}

export class PrUnavailableError extends Error {
  readonly reason: Unavailable;

  constructor(reason: Unavailable, message: string = reason) {
    super(message);
    this.name = "PrUnavailableError";
    this.reason = reason;
  }
}
