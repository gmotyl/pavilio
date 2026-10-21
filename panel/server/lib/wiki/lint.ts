import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";

import { parsePage, walkWikiPages } from "./pages";
import { resolveWikiLink, type LinkContext } from "./links";
import { extractWikiLinks, parseWikiLink, wikiLinkKey, type WikiLink } from "./wikilinks";

/**
 * Read-only health check of one project's wiki (`scripts/wiki lint <p>`). Never writes.
 *
 * Every page is named by its project-relative path with `.md` (`wiki/concepts/x.md`), the file an
 * agent opens to fix it. Link targets keep their D14 form (`wiki/concepts/x`, `metro:wiki/…`).
 * Every array is sorted in code-unit order, so the same wiki always lints byte-identical.
 *
 * - **broken** — a body wikilink or a frontmatter `sources:` entry whose `.md` does not exist.
 *   Cross-project links resolve against the workspace root. All walked pages are checked,
 *   generated indexes included (a dangling index line means the index is stale).
 * - **orphans** — pages nothing links to. Inbound links are body wikilinks from non-index wiki
 *   pages, frontmatter `sources:` citations, and body wikilinks in the project's `CONTEXT.md`.
 *   Links from generated `index.md` pages never count: every page is listed in one, so otherwise
 *   nothing could be an orphan. Frontmatter `entities:` / `concepts:` slugs do not count either —
 *   they are the mentions ledger, not navigation. Exempt: index pages, `overview.md`,
 *   `open-questions.md`, `repos/<repo>/ARCHITECTURE.md` (the repo entry point), and the
 *   interaction layer `questions/**` and `notes/**`, which are reached from the log, not linked.
 * - **malformed** — pages whose frontmatter fence holds YAML that does not parse (typically an
 *   unquoted `: ` in a value); reported with the parser's error, and not again as untyped.
 * - **untyped** — pages without a frontmatter `type`.
 * - **stale** — a page whose `updated` (YYYY-MM-DD) is older than one of its sources: each
 *   resolvable `sources:` entry, the `record:` file (project-relative, as in the ledger) and the `raw:` file
 *   (wiki-relative, `wiki/…` accepted). Day granularity: stale when the source's date is after
 *   `updated`. Checkout mtimes are never trusted for tracked files (clone, pull and auto-sync
 *   reset them): a wiki-page source is dated by its own frontmatter `updated` (else `created`);
 *   any other file by its last commit date (`git log -1 --format=%cs`), falling back to its mtime
 *   as a local calendar date when untracked or git is unavailable. Uncommitted edits to a tracked
 *   file are therefore not seen until committed. Pages with no valid `updated` and missing source
 *   files are skipped (the latter are `broken` when they come from `sources:`).
 * - **codeIdentifiers** — `concepts/` and `entities/` pages naming code, which belongs under
 *   `repos/`. Rules, kept conservative so prose never trips them: `call` — a backticked
 *   `camelCase(`; `path` — a `*.ts` / `*.tsx` path anywhere; `component` — a multi-hump
 *   `PascalCase` name that is backticked or written `<Component …>`, minus a small allowlist of
 *   product names (`TypeScript`, `GitHub`, …); `fence` — a fenced code block, itself a violation
 *   in a knowledge page (its contents are scanned too). A name that is part of a reported path on
 *   the same line is reported once, as the path.
 */

export type BrokenLink = { page: string; target: string };
export type StalePage = { page: string; source: string; updated: string; modified: string };
export type CodeIdentifierRule = "call" | "path" | "component" | "fence";
export type CodeIdentifier = { page: string; line: number; rule: CodeIdentifierRule; match: string };

export type MalformedPage = { page: string; error: string };

export type LintReport = {
  broken: BrokenLink[];
  malformed: MalformedPage[];
  orphans: string[];
  untyped: string[];
  stale: StalePage[];
  codeIdentifiers: CodeIdentifier[];
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pagePath = (wikiRel: string) => `wiki/${wikiRel}`;
const pageKey = (wikiRel: string) => `wiki/${wikiRel.replace(/\.md$/, "")}`;
const isIndexPage = (wikiRel: string) => wikiRel === "index.md" || wikiRel.endsWith("/index.md");
const linkText = (link: WikiLink) => (link.project ? `${link.project}:${link.target}` : link.target);

function isOrphanExempt(wikiRel: string): boolean {
  return (
    isIndexPage(wikiRel) ||
    wikiRel === "overview.md" ||
    wikiRel === "open-questions.md" ||
    wikiRel.startsWith("questions/") ||
    wikiRel.startsWith("notes/") ||
    /^repos\/[^/]+\/ARCHITECTURE\.md$/.test(wikiRel)
  );
}

/**
 * A `sources:` entry is a project-root path, bracketed or bare, with or without `.md`
 * (`wiki/sources/note-x.md`, `[[wiki/sources/note-x]]`).
 */
function parseSourceEntry(entry: string): WikiLink | null {
  const inner = /^\s*\[\[([^\[\]\n]+)\]\]\s*$/.exec(entry);
  return parseWikiLink(inner ? inner[1] : entry);
}

/**
 * Resolve a `sources:` entry; a wiki-relative entry (`sources/note-x`) that misses as a
 * project-root path is retried under `wiki/`. Returns the link that resolved, else the original.
 */
function resolveSourceEntry(link: WikiLink, ctx: LinkContext): { link: WikiLink; exists: boolean; absPath: string } {
  const direct = resolveWikiLink(link, ctx);
  if (direct.exists || link.project || link.target.startsWith("wiki/")) return { link, ...direct };
  const wikiLink = { ...link, target: `wiki/${link.target}` };
  const fallback = resolveWikiLink(wikiLink, ctx);
  return fallback.exists ? { link: wikiLink, ...fallback } : { link, ...direct };
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function mtimeDate(absPath: string): string | null {
  try {
    return localDate(statSync(absPath).mtime);
  } catch {
    return null;
  }
}

/** Git env a hook may have exported; it would point the lookup at the hook's repo. */
const REPO_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_PREFIX"];

/** Last commit date (YYYY-MM-DD) of a file, or null when untracked or git fails. */
function commitDate(absPath: string): string | null {
  const env = { ...process.env };
  for (const key of REPO_ENV) delete env[key];
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", basename(absPath)], {
      cwd: dirname(absPath),
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return DATE.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Date of a non-page source file: last commit, else mtime. */
const fileDate = (absPath: string) => commitDate(absPath) ?? mtimeDate(absPath);

/** Date of a wiki-page source: its frontmatter `updated`, else `created`, else its file date. */
function pageDate(absPath: string): string | null {
  try {
    const { updated, created } = parsePage(readFileSync(absPath, "utf8")).frontmatter;
    if (updated && DATE.test(updated)) return updated;
    if (created && DATE.test(created)) return created;
  } catch {
    return null;
  }
  return fileDate(absPath);
}

// --- code identifiers ---------------------------------------------------------------------------

const PASCAL = "[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+";
const CALL = /\b[a-z][a-z0-9]*[A-Z]\w*\s*\(/g;
const PATH = /(?<![\w./-])[\w-]+(?:\/[\w.-]+)*\.tsx?(?![\w-])/g;
const JSX = new RegExp(`<\\/?(${PASCAL})(?=[\\s/>])`, "g");
const BACKTICKED_PASCAL = new RegExp(`(?<![\\w.])${PASCAL}(?![\\w])`, "g");
const CODE_SPAN = /(`+)(?!`)(.*?[^`])\1(?!`)/g;

/** Product names that are PascalCase without being components. */
const PRODUCT_NAMES = new Set([
  "TypeScript", "JavaScript", "GitHub", "GitLab", "OpenSpec", "PowerShell", "PostgreSQL", "MySQL",
  "MongoDB", "YouTube", "LinkedIn", "WordPress", "PayPal", "OpenAI", "DevOps", "NextJs", "NodeJs",
  "WebSocket", "OAuth", "GraphQL", "JetBrains", "IntelliJ", "PyPI", "VsCode", "ChatGPT", "DynamoDB",
]);

function scanCodeIdentifiers(page: string, text: string, firstLine: number): CodeIdentifier[] {
  const found: CodeIdentifier[] = [];
  const add = (line: number, rule: CodeIdentifierRule, match: string) =>
    found.push({ page, line, rule, match: match.trim() });
  const addComponent = (line: number, name: string) => {
    if (!PRODUCT_NAMES.has(name)) add(line, "component", name);
  };
  const scanCode = (code: string, line: number) => {
    for (const m of code.matchAll(CALL)) add(line, "call", m[0].replace(/\s+/g, ""));
    for (const m of code.matchAll(BACKTICKED_PASCAL)) addComponent(line, m[0]);
  };
  let fence: { char: string; len: number } | null = null;
  text.split("\n").forEach((content, i) => {
    const line = firstLine + i;
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(content);
    if (fence) {
      const close = open && open[1][0] === fence.char && open[1].length >= fence.len
        && content.slice(open[0].length).trim() === "";
      if (close) fence = null;
      else {
        scanCode(content, line);
        for (const m of content.matchAll(PATH)) add(line, "path", m[0]);
      }
      return;
    }
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      add(line, "fence", content);
      return;
    }
    for (const m of content.matchAll(CODE_SPAN)) scanCode(m[2], line);
    for (const m of content.matchAll(PATH)) add(line, "path", m[0]);
    for (const m of content.matchAll(JSX)) addComponent(line, m[1]);
  });
  // `src/AppShell.tsx` is one finding, the path, not also the component `AppShell`.
  const paths = found.filter((f) => f.rule === "path");
  return found.filter(
    (f) => f.rule !== "component" || !paths.some((p) => p.line === f.line && p.match.includes(f.match)),
  );
}

/** 1-based file line of the body's first line: the frontmatter block sits above it. */
function bodyFirstLine(absPath: string, body: string): number {
  try {
    const text = readFileSync(absPath, "utf8");
    const prefix = text.slice(0, text.length - body.length);
    return prefix.split("\n").length;
  } catch {
    return 1;
  }
}

// --- lint ---------------------------------------------------------------------------------------

/** Lint `projects/<project>/wiki` under `workspaceRoot` (the dir containing `projects/`). */
export function lintWiki(workspaceRoot: string, project: string): LintReport {
  const projectDir = join(workspaceRoot, "projects", project);
  const wikiDir = join(projectDir, "wiki");
  const pages = walkWikiPages(wikiDir);
  const ctx = { workspaceRoot, project };

  const broken: BrokenLink[] = [];
  const untyped: string[] = [];
  const malformed: MalformedPage[] = [];
  const stale: StalePage[] = [];
  const codeIdentifiers: CodeIdentifier[] = [];
  const inbound = new Map<string, Set<string>>(); // target key → linking page keys

  const addInbound = (link: WikiLink, from: string) => {
    const to = wikiLinkKey(link, project);
    if (to === from) return;
    let set = inbound.get(to);
    if (!set) inbound.set(to, (set = new Set()));
    set.add(from);
  };

  for (const page of pages) {
    const path = pagePath(page.path);
    const from = pageKey(page.path);
    const fromIndex = isIndexPage(page.path);

    const brokenTargets = new Set<string>();
    for (const link of extractWikiLinks(page.body)) {
      if (!resolveWikiLink(link, ctx).exists) brokenTargets.add(linkText(link));
      if (!fromIndex) addInbound(link, from);
    }

    const sourceFiles: { source: string; absPath: string; isPage: boolean }[] = [];
    for (const entry of page.frontmatter.sources ?? []) {
      const link = parseSourceEntry(entry);
      if (!link) {
        brokenTargets.add(entry.trim());
        continue;
      }
      const resolved = resolveSourceEntry(link, ctx);
      const source = resolved.link;
      if (!resolved.exists) brokenTargets.add(linkText(source));
      else sourceFiles.push({ source: linkText(source), absPath: resolved.absPath, isPage: source.target.startsWith("wiki/") });
      if (!fromIndex) addInbound(source, from);
    }
    for (const target of brokenTargets) broken.push({ page: path, target });

    if (page.frontmatterError) malformed.push({ page: path, error: page.frontmatterError });
    else if (!page.frontmatter.type) untyped.push(path);

    const { record, raw, updated } = page.frontmatter;
    if (record) {
      const rel = record.replace(/^\/+/, "");
      sourceFiles.push({ source: record, absPath: join(projectDir, rel), isPage: false });
    }
    if (raw) {
      const rel = raw.replace(/^\/+/, "");
      sourceFiles.push({ source: raw, absPath: rel.startsWith("wiki/") ? join(projectDir, rel) : join(wikiDir, rel), isPage: false });
    }
    if (updated && DATE.test(updated)) {
      const seen = new Set<string>();
      for (const { source, absPath, isPage } of sourceFiles) {
        if (seen.has(source)) continue;
        seen.add(source);
        const modified = isPage ? pageDate(absPath) : fileDate(absPath);
        if (modified && modified > updated) stale.push({ page: path, source, updated, modified });
      }
    }

    if (page.path.startsWith("concepts/") || page.path.startsWith("entities/")) {
      const abs = join(wikiDir, ...page.path.split("/"));
      codeIdentifiers.push(...scanCodeIdentifiers(path, page.body, bodyFirstLine(abs, page.body)));
    }
  }

  // The glossary points at concept pages; those links make them reachable.
  const contextPath = join(projectDir, "CONTEXT.md");
  if (existsSync(contextPath)) {
    for (const link of extractWikiLinks(readFileSync(contextPath, "utf8"))) addInbound(link, "CONTEXT");
  }

  const orphans = pages
    .filter((p) => !isOrphanExempt(p.path) && !(inbound.get(pageKey(p.path))?.size))
    .map((p) => pagePath(p.path));

  return {
    broken: broken.sort((a, b) => byString(a.page, b.page) || byString(a.target, b.target)),
    orphans: orphans.sort(byString),
    malformed: malformed.sort((a, b) => byString(a.page, b.page)),
    untyped: untyped.sort(byString),
    stale: stale.sort((a, b) => byString(a.page, b.page) || byString(a.source, b.source)),
    codeIdentifiers: codeIdentifiers.sort(
      (a, b) => byString(a.page, b.page) || a.line - b.line || byString(a.rule, b.rule) || byString(a.match, b.match),
    ),
  };
}
