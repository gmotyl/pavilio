import { readFileSync } from "fs";
import { join } from "path";

import { walkWikiPages, type WikiPage } from "./pages";
import { extractWikiLinks } from "./wikilinks";

/**
 * Slugs are namespaced by the knowledge page they would become, as a wiki-relative path without
 * `.md`: `entities/<slug>` (from frontmatter `entities:`) and `concepts/<slug>` (from
 * `concepts:`). A page writer for slug `concepts/x` writes `wiki/concepts/x.md`, so an entity and a
 * concept sharing a bare name never collide. Frontmatter lists carry bare names; a name that
 * already carries its own namespace prefix (`concepts/x` under `concepts:`) is accepted as is.
 */
export type MentionsResult = {
  slugs: Record<string, string[]>; // slug → sorted wiki-relative paths of the source-like pages naming it
  qualifying: string[]; // sorted slugs whose knowledge page should be written now
};

export type MentionsOptions = {
  touched?: string[]; // namespaced slugs this run touched; narrows `qualifying`
  pages?: WikiPage[]; // the project's `walkWikiPages` result, to skip walking again
};

/** Mentions needed before a slug earns a knowledge page, unless it is a glossary term. */
export const MENTION_THRESHOLD = 2;

const NAMESPACES = ["entities", "concepts"] as const;

/** Source-like pages: `sources/**` and anything inside a repo subtree `repos/<repo>/**`. */
function isSourceLike(path: string): boolean {
  return path.startsWith("sources/") || /^repos\/[^/]+\/.+/.test(path);
}

function pageSlugs(page: WikiPage): Set<string> {
  const slugs = new Set<string>();
  for (const ns of NAMESPACES) {
    for (const raw of page.frontmatter[ns] ?? []) {
      const name = raw.trim().replace(/\.md$/i, "").replace(new RegExp(`^${ns}/`), "");
      if (name) slugs.add(`${ns}/${name}`);
    }
  }
  return slugs;
}

/**
 * Concept slugs the glossary points at (`See [[wiki/concepts/<slug>]]`). A missing CONTEXT.md is
 * an empty glossary; links into another project's wiki are ignored.
 */
export function glossarySlugs(contextMarkdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const link of extractWikiLinks(contextMarkdown)) {
    if (link.project) continue;
    if (/^wiki\/concepts\/.+/.test(link.target)) slugs.add(link.target.slice("wiki/".length));
  }
  return slugs;
}

function readGlossary(contextPath: string): Set<string> {
  try {
    return glossarySlugs(readFileSync(contextPath, "utf8"));
  } catch {
    return new Set();
  }
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Count which source-like pages of `<projectDir>/wiki` name each slug. A slug qualifies at
 * `MENTION_THRESHOLD` distinct pages, or at one when `<projectDir>/CONTEXT.md` lists it as a
 * glossary term. `questions/` and `notes/` (and every other non-source page) never count.
 */
export function countMentions(projectDir: string, options: MentionsOptions = {}): MentionsResult {
  const sets = new Map<string, Set<string>>();
  for (const page of options.pages ?? walkWikiPages(join(projectDir, "wiki"))) {
    if (!isSourceLike(page.path)) continue;
    for (const slug of pageSlugs(page)) {
      let set = sets.get(slug);
      if (!set) sets.set(slug, (set = new Set()));
      set.add(page.path);
    }
  }

  const glossary = readGlossary(join(projectDir, "CONTEXT.md"));
  const touched = options.touched ? new Set(options.touched) : null;
  const slugs: Record<string, string[]> = {};
  const qualifying: string[] = [];
  for (const slug of [...sets.keys()].sort(byCodeUnit)) {
    const pages = [...sets.get(slug)!].sort(byCodeUnit);
    slugs[slug] = pages;
    const enough = pages.length >= (glossary.has(slug) ? 1 : MENTION_THRESHOLD);
    if (enough && (!touched || touched.has(slug))) qualifying.push(slug);
  }
  return { slugs, qualifying };
}
