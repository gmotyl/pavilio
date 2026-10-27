/** Atlassian Cloud URL parsing, shared by fetch-article (host refusal) and save-atlassian (naming). */

export type AtlassianRef =
  | { kind: "confluence"; host: string; id: string }
  | { kind: "jira"; host: string; key: string };

const JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** True when the URL's host is an Atlassian Cloud site (`*.atlassian.net`). */
export function isAtlassianHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

/** The page id or issue key a Confluence/Jira URL points at, or null for any other URL. */
export function parseAtlassianUrl(url: string): AtlassianRef | null {
  if (!isAtlassianHost(url)) return null;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  const page =
    /^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/.exec(path)?.[1] ??
    /^\/wiki\/pages\/(\d+)\/?$/.exec(path)?.[1] ??
    (/^\/wiki\/pages\/viewpage\.action$/.test(path) ? parsed.searchParams.get("pageId") : null);
  if (page && /^\d+$/.test(page)) return { kind: "confluence", host, id: page };

  const key = /^\/browse\/([^/]+)\/?$/.exec(path)?.[1] ?? parsed.searchParams.get("selectedIssue");
  if (key && JIRA_KEY.test(key)) return { kind: "jira", host, key };
  return null;
}
