import type { PullRequest } from "../../../../server/lib/prs/provider";

export const ME = "greg";

export function pr(over: Partial<PullRequest> & { number: number }): PullRequest {
  return {
    repo: "pavilio",
    repoPath: "/root/git/prv/pavilio",
    title: `PR ${over.number}`,
    author: "anna",
    isDraft: false,
    reviewers: [],
    reviewDecision: null,
    checks: "none",
    head: `feat/${over.number}`,
    headSha: `sha${over.number}`,
    base: "main",
    updatedAt: "2026-11-22T10:00:00Z",
    url: `https://github.com/gmotyl/pavilio/pull/${over.number}`,
    forge: "github",
    ...over,
  };
}

// greg authors 1 and 2; anna asks greg to review 3 and 4; bob asks greg to review 5; 6 is nobody's business.
export const PRS: PullRequest[] = [
  pr({ number: 1, author: ME }),
  pr({ number: 2, author: ME, reviewers: ["anna"] }),
  pr({ number: 3, author: "anna", reviewers: [ME] }),
  pr({ number: 4, author: "anna", reviewers: [ME, "bob"] }),
  pr({ number: 5, author: "bob", reviewers: [ME] }),
  pr({ number: 6, author: "bob" }),
];
