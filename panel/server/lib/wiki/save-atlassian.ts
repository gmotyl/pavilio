import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { ensureContainedDir } from "./contained-dir";
import { countWords, refuseSymlink, slugify } from "./raw-snapshot";

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
  /** Written in order; entries keep integer-like keys where a plain object would sort them first. */
  meta?: Record<string, string> | Array<[string, string]>;
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

/** Why `body` is not worth a snapshot (empty or a login wall), or null when it is. */
function stubWarning(body: string): string | null {
  if (!body.trim()) return "empty body — the MCP returned no content";
  const words = countWords(body);
  if (words < LOGIN_MARKER_MAX_WORDS && LOGIN_MARKERS.some((re) => re.test(body))) {
    return `body is only ${words} words and matches a login marker — likely a sign-in page, not the content`;
  }
  return null;
}

/** One line: a newline in a title or meta value must not start a heading of its own. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The lowercased host in an existing snapshot's `source_url` frontmatter, or null when it has none parseable. */
function snapshotHost(file: string): string | null {
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  const quoted = /^source_url: (.*)$/m.exec(frontmatter)?.[1];
  if (quoted === undefined) return null;
  try {
    const url: unknown = JSON.parse(quoted);
    return typeof url === "string" ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Why an existing snapshot under the same id is not this page, or null when every one is.
 * Ids and keys are site-scoped but the file name drops the host, so `CHK-42` on another site
 * would silently overwrite this one. A snapshot without a parseable `source_url` cannot prove it
 * is the same page, so it blocks the save too: refusing is recoverable, overwriting is not.
 */
function collisionWarning(rawDir: string, files: string[], host: string): string | null {
  for (const name of files) {
    const file = join(rawDir, name);
    // Only regular files carry a source_url; anything else fails the write on its own.
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const existing = snapshotHost(file);
    if (existing === host) continue;
    const from = existing ?? "an unknown site (no parseable source_url)";
    return `cross-site collision — raw/${name} holds a snapshot from ${from}, not ${host}; nothing written`;
  }
  return null;
}

/** Save the snapshot of `url`; throws when `url` is not a Confluence page or Jira issue URL. */
export function saveAtlassian(projectDir: string, url: string, opts: SaveAtlassianOptions): AtlassianReceipt {
  const ref = parseAtlassianUrl(url);
  if (!ref) throw new Error(`not a Confluence page or Jira issue URL: ${url}`);
  const title = oneLine(opts.title) || url;

  const warning = stubWarning(opts.body);
  if (warning) return { raw: "", title, warning };

  const rawDir = ensureContainedDir(projectDir, ["wiki", "raw"]);
  const name =
    ref.kind === "jira" ? `jira-${ref.key}.md` : `confluence-${ref.id}-${slugify(title) || "untitled"}.md`;
  const file = join(rawDir, name);
  // The page id is the identity; a renamed page leaves its old-slug snapshot behind otherwise.
  const prefix = ref.kind === "confluence" ? `confluence-${ref.id}-` : null;
  const oldSlugs = prefix
    ? readdirSync(rawDir).filter((old) => old !== name && old.startsWith(prefix) && old.endsWith(".md"))
    : [];
  // Every check runs before the first removal, so a refused save deletes nothing.
  refuseSymlink(file);
  for (const old of oldSlugs) refuseSymlink(join(rawDir, old));
  const collision = collisionWarning(rawDir, [name, ...oldSlugs], ref.host);
  if (collision) return { raw: "", title, warning: collision };

  const replaced: string[] = [];
  for (const old of oldSlugs) {
    rmSync(join(rawDir, old));
    replaced.push(`raw/${old}`);
  }

  const captured = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const pairs = Array.isArray(opts.meta) ? opts.meta : Object.entries(opts.meta ?? {});
  const meta = pairs.map(([key, value]) => `- ${oneLine(key)}: ${oneLine(value)}`);
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
  writeFileSync(file, `${header}${opts.body}`);

  const receipt: AtlassianReceipt = { raw: `raw/${name}`, title };
  if (replaced.length) receipt.replaced = replaced;
  return receipt;
}
