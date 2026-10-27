import { lstatSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { ensureContainedDir } from "./contained-dir";
import { slugify } from "./fetch-article";

/**
 * Write an Atlassian snapshot — one Confluence page or Jira issue the agent already fetched through
 * its Atlassian MCP — into `<projectDir>/wiki/raw/`, named by page id (`confluence-<id>-<slug>.md`)
 * or issue key (`jira-<KEY>.md`). No network here: the body arrives as text.
 */

export type AtlassianRef =
  | { kind: "confluence"; host: string; id: string }
  | { kind: "jira"; host: string; key: string };

export type AtlassianReceipt = {
  /** Raw file path relative to the wiki dir, e.g. `raw/jira-ABC-1.md`; empty when nothing was written. */
  raw: string;
  title: string;
  /** Older snapshots of the same page under another slug, removed by this save. */
  replaced?: string[];
  warning?: string;
};

export type SaveAtlassianOptions = {
  title: string;
  body: string;
  meta?: Record<string, string>;
  now?: Date;
};

/** A login marker only counts on bodies shorter than this; real pages may mention logging in. */
export const LOGIN_MARKER_MAX_WORDS = 50;

const LOGIN_MARKERS = [/log in/i, /sign up/i, /atlassian account/i, /you need to log in/i, /continue with google/i];

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

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Why `body` is not worth a snapshot (empty or a login wall), or null when it is. */
function stubWarning(body: string): string | null {
  if (!body.trim()) return "empty body — the MCP returned no content";
  const words = countWords(body);
  if (words < LOGIN_MARKER_MAX_WORDS && LOGIN_MARKERS.some((re) => re.test(body))) {
    return `body is only ${words} words and matches a login marker — likely a sign-in page, not the content`;
  }
  return null;
}

/** A planted symlink must never redirect the write or the removal. */
function refuseSymlink(file: string): void {
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`refusing a symlinked raw snapshot: ${file}`);
  }
}

/** Save the snapshot of `url`; throws when `url` is not a Confluence page or Jira issue URL. */
export function saveAtlassian(projectDir: string, url: string, opts: SaveAtlassianOptions): AtlassianReceipt {
  const ref = parseAtlassianUrl(url);
  if (!ref) throw new Error(`not a Confluence page or Jira issue URL: ${url}`);
  const title = opts.title.trim() || url;

  const warning = stubWarning(opts.body);
  if (warning) return { raw: "", title, warning };

  const rawDir = ensureContainedDir(projectDir, ["wiki", "raw"]);
  const name =
    ref.kind === "jira" ? `jira-${ref.key}.md` : `confluence-${ref.id}-${slugify(title) || "untitled"}.md`;

  // The page id is the identity; a renamed page leaves its old-slug snapshot behind otherwise.
  const replaced: string[] = [];
  if (ref.kind === "confluence") {
    const prefix = `confluence-${ref.id}-`;
    for (const old of readdirSync(rawDir)) {
      if (old === name || !old.startsWith(prefix) || !old.endsWith(".md")) continue;
      const file = join(rawDir, old);
      refuseSymlink(file);
      rmSync(file);
      replaced.push(`raw/${old}`);
    }
  }

  const captured = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const meta = Object.entries(opts.meta ?? {}).map(([key, value]) => `- ${key}: ${value}`);
  const header = [
    "---",
    `source_url: ${JSON.stringify(url)}`,
    `captured: ${captured}`,
    "---",
    "",
    `# ${title}`,
    "",
    ...(meta.length ? [...meta, ""] : []),
    "",
  ].join("\n");
  const file = join(rawDir, name);
  refuseSymlink(file);
  writeFileSync(file, `${header}${opts.body}`);

  const receipt: AtlassianReceipt = { raw: `raw/${name}`, title };
  if (replaced.length) receipt.replaced = replaced;
  return receipt;
}
