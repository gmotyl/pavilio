import { existsSync } from "fs";
import { join } from "path";

import { walkWikiPages } from "./pages";
import { extractWikiLinks, wikiLinkKey, type WikiLink } from "./wikilinks";

export type LinkContext = {
  workspaceRoot: string; // the dir that contains `projects/`
  project: string; // project the linking page belongs to
};

export type ResolvedWikiLink = WikiLink & {
  project: string; // the prefix, else the current project
  absPath: string; // `<workspaceRoot>/projects/<project>/<target>.md`
  exists: boolean;
};

/** Resolve a parsed link to its `.md` file under `projects/<project>/`. */
export function resolveWikiLink(link: WikiLink, ctx: LinkContext): ResolvedWikiLink {
  const project = link.project ?? ctx.project;
  const absPath = join(ctx.workspaceRoot, "projects", project, ...link.target.split("/")) + ".md";
  return { ...link, project, absPath, exists: existsSync(absPath) };
}

/** Project-relative page key without `.md`, e.g. `concepts/x.md` → `wiki/concepts/x`. */
const pageKey = (wikiRelPath: string) => `wiki/${wikiRelPath.replace(/\.md$/, "")}`;

/**
 * Backlink map of one project's wiki: target key → sorted, de-duplicated keys of the wiki pages
 * linking to it (self-links dropped). Keys use `wikiLinkKey` form — project-relative path without
 * `.md` (`wiki/concepts/x`, `progress/2026-10-19-a`), `<project>:`-prefixed for other projects.
 * Every wiki page has an entry (empty when nothing links to it); non-wiki targets appear only when
 * linked.
 */
export function buildBacklinks(workspaceRoot: string, project: string): Record<string, string[]> {
  const sets = new Map<string, Set<string>>();
  const pages = walkWikiPages(join(workspaceRoot, "projects", project, "wiki"));
  for (const page of pages) sets.set(pageKey(page.path), new Set());
  for (const page of pages) {
    const from = pageKey(page.path);
    for (const link of extractWikiLinks(page.body)) {
      const to = wikiLinkKey(link, project);
      if (to === from) continue;
      let set = sets.get(to);
      if (!set) sets.set(to, (set = new Set()));
      set.add(from);
    }
  }
  const map: Record<string, string[]> = {};
  for (const [key, set] of sets) map[key] = [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return map;
}
