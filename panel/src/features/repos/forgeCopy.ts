import type { Forge } from "../../../server/lib/prs/provider";

export interface ForgeCopy {
  name: "GitHub" | "GitLab";
  /** The PR's number as the forge writes it: `#244` on GitHub, `!244` on GitLab. */
  number(n: number): string;
  /** The file at `head` on the forge: what a rendered file's relative links resolve against. */
  blobUrl(prUrl: string, head: string, path: string): string;
  /** The file's raw bytes at `head`: what its relative images resolve against (a blob page is HTML). */
  rawUrl(prUrl: string, head: string, path: string): string;
}

/** The repo's web root from its PR URL; GitHub `…/pull/n`, GitLab `…/-/merge_requests/n`. */
const PR_URL: Record<Forge, RegExp> = {
  github: /^(https?:\/\/[^?#]+)\/pull\/\d+\/?$/,
  gitlab: /^(https?:\/\/[^?#]+)\/-\/merge_requests\/\d+\/?$/,
};

/** Where blob/raw pages sit under the repo root. */
const FILE_SEGMENT: Record<Forge, string> = { github: "", gitlab: "/-" };

/**
 * A file page at the reviewed head. A PR URL of another shape gives `about:blank`,
 * which no relative URL resolves against — those links drop, absolute ones still work.
 */
function fileUrl(forge: Forge, kind: "blob" | "raw", prUrl: string, head: string, path: string): string {
  const repo = PR_URL[forge].exec(prUrl)?.[1];
  if (!repo) return "about:blank";
  const file = path.split("/").map(encodeURIComponent).join("/");
  return `${repo}${FILE_SEGMENT[forge]}/${kind}/${encodeURIComponent(head)}/${file}`;
}

/** The forge-specific words and URLs the client shows for a PR. */
export function forgeCopy(forge: Forge): ForgeCopy {
  return {
    name: forge === "gitlab" ? "GitLab" : "GitHub",
    number: (n) => `${forge === "gitlab" ? "!" : "#"}${n}`,
    blobUrl: (prUrl, head, path) => fileUrl(forge, "blob", prUrl, head, path),
    rawUrl: (prUrl, head, path) => fileUrl(forge, "raw", prUrl, head, path),
  };
}
