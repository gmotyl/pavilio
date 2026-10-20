import { join } from "path";

import { pageTitle } from "./index-md";
import { buildBacklinksIn } from "./links";
import { countMentions } from "./mentions";
import { ENTITY_KINDS, walkWikiPages, type WikiPage } from "./pages";
import { parseWikiLink } from "./wikilinks";

/**
 * One wiki page as the panel's wiki tab sees it. Every path in this payload (`path`, `backlinks`,
 * `sources`) is PROJECT-relative, "/"-separated and keeps `.md` — e.g. `wiki/concepts/x.md` — so
 * the client can prefix `<project>/` for `?file=` / the files API.
 */
export type WikiPageInfo = {
  path: string;
  title: string;
  description: string | null;
  type: string | null;
  sourceCount: number; // === sources.length
  updated: string | null; // YYYY-MM-DD
  created: string | null; // YYYY-MM-DD
  backlinks: string[]; // wiki pages linking here, generated index pages excluded
  sources: string[]; // source-like pages naming this page's slug, plus its own `sources:` list
};

export type WikiPageGroup = { count: number; pages: WikiPageInfo[] };

export type WikiTree = {
  project: string;
  overview: WikiPageInfo | null;
  entities: { count: number; kinds: (WikiPageGroup & { kind: string })[] };
  concepts: WikiPageGroup;
  repos: { count: number; repos: (WikiPageGroup & { name: string })[] };
  interaction: {
    count: number;
    openQuestions: WikiPageInfo | null;
    openQuestionsCount: number | null; // top-level bullets in open-questions.md; null without it
    notes: WikiPageInfo[];
    questions: WikiPageInfo[];
  };
  sources: { count: number; kinds: (WikiPageGroup & { kind: string })[] };
  other: WikiPageInfo[]; // listed pages that fit no section
};

/** Kind bucket for entity pages without a valid frontmatter `kind`, and for unprefixed sources. */
const OTHER_KIND = "other";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: Iterable<string>) => [...new Set(values)].sort(byCodeUnit);

const isIndexPage = (page: WikiPage) => page.frontmatter.type === "index";
const wikiKeyToPath = (key: string) => `${key}.md`; // `wiki/concepts/x` → `wiki/concepts/x.md`

/** Source kind from a subdir `sources/<kind>/…` or a filename `sources/<kind>-<stem>.md`. */
export function sourceKind(wikiRelPath: string): string {
  const rest = wikiRelPath.slice("sources/".length);
  const slash = rest.indexOf("/");
  if (slash > 0) return rest.slice(0, slash);
  const dash = rest.indexOf("-");
  return dash > 0 ? rest.slice(0, dash) : OTHER_KIND;
}

/**
 * Normalise one frontmatter `sources:` entry to a wiki-relative path with `.md`. Accepts
 * `[[wiki/sources/x]]`, `wiki/sources/x(.md)` and `sources/x(.md)`; links into other projects or
 * outside the wiki are dropped.
 */
function ownSourcePath(entry: string, project: string): string | null {
  const inner = entry.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  const link = parseWikiLink(inner);
  if (!link || (link.project && link.project !== project)) return null;
  const target = link.target.startsWith("wiki/") ? link.target.slice("wiki/".length) : link.target;
  return target ? `${target}.md` : null;
}

/** Unindented `- ` / `* ` / `+ ` list items outside code fences: one per open question. */
export function countTopLevelBullets(markdown: string): number {
  let count = 0;
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence === null && /^[-*+][ \t]+\S/.test(line)) count++;
  }
  return count;
}

/** Build the wiki tab payload for `<projectsDir>/<project>/wiki`. */
export function buildWikiTree(projectsDir: string, project: string): WikiTree {
  const projectDir = join(projectsDir, project);
  const pages = walkWikiPages(join(projectDir, "wiki"));
  const indexKeys = new Set(pages.filter(isIndexPage).map((p) => `wiki/${p.path.replace(/\.md$/, "")}`));
  // One walk per request, shared by the backlink map and the mention count.
  const backlinks = buildBacklinksIn(projectsDir, project, pages);
  const mentions = countMentions(projectDir, { pages }).slugs;
  const existing = new Set(pages.map((p) => p.path));

  const info = (page: WikiPage): WikiPageInfo => {
    const slug = page.path.replace(/\.md$/, ""); // namespaced slug, e.g. `concepts/x`
    const own = (page.frontmatter.sources ?? [])
      .map((s) => ownSourcePath(s, project))
      .filter((p): p is string => p !== null && existing.has(p));
    const sources = sortedUnique([...(mentions[slug] ?? []), ...own])
      .filter((p) => p !== page.path)
      .map((p) => `wiki/${p}`);
    const fm = page.frontmatter;
    return {
      path: `wiki/${page.path}`,
      title: pageTitle(page),
      description: fm.description ?? null,
      type: fm.type ?? null,
      sourceCount: sources.length,
      updated: fm.updated ?? null,
      created: fm.created ?? null,
      backlinks: (backlinks[`wiki/${slug}`] ?? []).filter((k) => !indexKeys.has(k)).map(wikiKeyToPath),
      sources,
    };
  };

  const tree: WikiTree = {
    project,
    overview: null,
    entities: { count: 0, kinds: [] },
    concepts: { count: 0, pages: [] },
    repos: { count: 0, repos: [] },
    interaction: { count: 0, openQuestions: null, openQuestionsCount: null, notes: [], questions: [] },
    sources: { count: 0, kinds: [] },
    other: [],
  };
  const entityKinds = new Map<string, WikiPageInfo[]>();
  const repos = new Map<string, WikiPageInfo[]>();
  const sourceKinds = new Map<string, WikiPageInfo[]>();
  const push = (map: Map<string, WikiPageInfo[]>, key: string, item: WikiPageInfo) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  // `pages` is sorted by path, so every bucket below stays sorted too.
  for (const page of pages) {
    if (isIndexPage(page)) continue; // generated navigation, never listed
    const item = info(page);
    const p = page.path;
    if (p === "overview.md") tree.overview = item;
    else if (p.startsWith("entities/")) push(entityKinds, page.frontmatter.kind ?? OTHER_KIND, item);
    else if (p.startsWith("concepts/")) tree.concepts.pages.push(item);
    else if (/^repos\/[^/]+\/.+/.test(p)) push(repos, p.split("/")[1], item);
    else if (p === "open-questions.md") {
      tree.interaction.openQuestions = item;
      tree.interaction.openQuestionsCount = countTopLevelBullets(page.body);
    }
    else if (p.startsWith("notes/")) tree.interaction.notes.push(item);
    else if (p.startsWith("questions/")) tree.interaction.questions.push(item);
    else if (p.startsWith("sources/")) push(sourceKinds, sourceKind(p), item);
    else tree.other.push(item);
  }

  // Entity kinds in their canonical order, the catch-all last.
  const kindOrder = [...ENTITY_KINDS, OTHER_KIND] as string[];
  tree.entities.kinds = kindOrder
    .filter((k) => entityKinds.has(k))
    .map((kind) => ({ kind, count: entityKinds.get(kind)!.length, pages: entityKinds.get(kind)! }));
  tree.entities.count = tree.entities.kinds.reduce((n, k) => n + k.count, 0);
  tree.concepts.count = tree.concepts.pages.length;
  tree.repos.repos = [...repos.keys()]
    .sort(byCodeUnit)
    .map((name) => ({ name, count: repos.get(name)!.length, pages: repos.get(name)! }));
  tree.repos.count = tree.repos.repos.reduce((n, r) => n + r.count, 0);
  tree.interaction.count =
    (tree.interaction.openQuestions ? 1 : 0) + tree.interaction.notes.length + tree.interaction.questions.length;
  tree.sources.kinds = [...sourceKinds.keys()]
    .sort(byCodeUnit)
    .map((kind) => ({ kind, count: sourceKinds.get(kind)!.length, pages: sourceKinds.get(kind)! }));
  tree.sources.count = tree.sources.kinds.reduce((n, k) => n + k.count, 0);
  return tree;
}
