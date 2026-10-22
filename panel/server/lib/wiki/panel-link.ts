import { encodePathSegments } from "../../../src/features/markdown/viewRoute";

/** `<project>/wiki/…`: a wiki page, which opens in its project's wiki tab. */
const WIKI_PAGE = /^([^/]+)\/wiki\//;

/**
 * The panel route for a projectsDir-relative path: a wiki page opens in its project's wiki tab
 * (`/project/<p>/wiki?file=…`), so the wiki tree stays beside it; any other file in the bare
 * viewer (`/view/<path>`, each segment percent-encoded so `#`, `?` and spaces stay in the path).
 * Always a root-relative path with no host or port. The markdown renderer's wikilinks use this
 * same function, so agent-printed links and rendered links never drift apart.
 */
export function panelLink(projectsRelPath: string): string {
  const project = WIKI_PAGE.exec(projectsRelPath)?.[1];
  return project
    ? `/project/${encodeURIComponent(project)}/wiki?file=${encodeURIComponent(projectsRelPath)}`
    : `/view/${encodePathSegments(projectsRelPath)}`;
}
