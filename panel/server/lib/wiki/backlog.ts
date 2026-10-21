import { join } from "path";

import { countMentions } from "./mentions";
import { walkWikiPages } from "./pages";

/**
 * What the page writers still owe (`scripts/wiki backlog <p>`), derived from the pages alone, so it
 * survives an interrupted run and catches a page writer that never finished.
 *
 * Every path is project-root form (`wiki/sources/<kind>-<stem>.md`), the form page writers take.
 *
 * - **create** — a qualifying slug (`countMentions`) with no knowledge page yet → every source-like
 *   page naming it.
 * - **update** — a slug whose knowledge page exists → the source-like pages naming it that the
 *   page's `sources:` does not cite yet. A page with nothing new is left out.
 * - **waiting** — a slug named by source-like pages that neither has a page nor qualifies.
 */
export type BacklogResult = {
  create: Record<string, string[]>;
  update: Record<string, string[]>;
  waiting: string[];
};

export type BacklogOptions = {
  touched?: string[]; // namespaced slugs; narrows every group to them
};

/**
 * A `sources:` entry as a wiki-relative path with `.md` — `wiki/sources/a.md`, `[[wiki/sources/a]]`,
 * `sources/a` all become `sources/a.md`, the form `countMentions` reports.
 */
function citedPath(entry: string): string {
  let path = entry.trim();
  const link = /^\[\[(.*)\]\]$/.exec(path);
  if (link) path = link[1].split("|")[0].split("#")[0].trim();
  path = path.replace(/^wiki\//, "");
  return path.endsWith(".md") ? path : `${path}.md`;
}

const projectRoot = (wikiRel: string) => `wiki/${wikiRel}`;

export function pageBacklog(projectDir: string, options: BacklogOptions = {}): BacklogResult {
  const pages = walkWikiPages(join(projectDir, "wiki"));
  const { slugs, qualifying } = countMentions(projectDir, { pages });
  const knowledge = new Map(pages.map((page) => [page.path.replace(/\.md$/, ""), page]));
  const qualifies = new Set(qualifying);
  const touched = options.touched ? new Set(options.touched) : null;

  const result: BacklogResult = { create: {}, update: {}, waiting: [] };
  for (const [slug, sources] of Object.entries(slugs)) {
    if (touched && !touched.has(slug)) continue;
    const page = knowledge.get(slug);
    if (page) {
      const cited = new Set((page.frontmatter.sources ?? []).map(citedPath));
      const fresh = sources.filter((source) => !cited.has(source));
      if (fresh.length) result.update[slug] = fresh.map(projectRoot);
    } else if (qualifies.has(slug)) {
      result.create[slug] = sources.map(projectRoot);
    } else {
      result.waiting.push(slug);
    }
  }
  return result;
}
