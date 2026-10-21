/**
 * Wikilinks (D14) for the markdown renderer: `[[<path from project root>]]`, optional
 * `<project>:` prefix, optional `|label`. Parsing is the server's pure module, shared as is.
 */
import { parseWikiLink, type WikiLink } from "../../../server/lib/wiki/wikilinks";
import { encodePathSegments } from "./viewRoute";

/** Attribute the plugin puts on every wikilink anchor: the target's projectsDir-relative path. */
export const WIKILINK_ATTR = "data-wikilink";
export const WIKILINK_MISSING_CLASS = "wikilink-missing";

/**
 * The project a file under projectsDir belongs to: the first segment of its path. Virtual
 * prefixes (`_root/…`, `_skills/…`, `_help/…`) are not projects, so they own no wikilinks.
 */
export function owningProject(basePath: string | undefined): string | undefined {
  const first = basePath?.split("/")[0];
  return first && !first.startsWith("_") ? first : undefined;
}

/** The projectsDir-relative `.md` path a link points at, or null when no project is known. */
export function wikiLinkPath(link: WikiLink, fromProject: string | undefined): string | null {
  const project = link.project ?? fromProject;
  return project ? `${project}/${link.target}.md` : null;
}

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

/**
 * The viewer route for a projectsDir-relative path, each segment percent-encoded so `#`, `?` and
 * spaces stay part of the path. Route consumers decode it back (`viewRoute.ts`).
 */
const viewerHref = (path: string) => `/view/${encodePathSegments(path)}`;

/** `<project>/wiki/…`: a wiki page, which opens in its project's wiki tab. */
const WIKI_PAGE = /^([^/]+)\/wiki\//;

/**
 * Where a wikilink target opens: a wiki page in its project's wiki tab (`?file=`), so the wiki
 * tree stays beside it; any other file in the bare viewer.
 */
function linkHref(path: string): string {
  const project = WIKI_PAGE.exec(path)?.[1];
  return project
    ? `/project/${encodeURIComponent(project)}/wiki?file=${encodeURIComponent(path)}`
    : viewerHref(path);
}

const LINK = /\[\[([^[\]\n]+)\]\]/g;

/** Nodes whose text must not become links: code is verbatim, and links cannot nest. */
const SKIP = new Set(["code", "inlineCode", "html", "link", "linkReference", "definition"]);

function splitText(value: string, fromProject: string | undefined): MdNode[] | null {
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(LINK)) {
    const link = parseWikiLink(match[1]);
    if (!link) continue;
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", value: value.slice(last, at) });
    const path = wikiLinkPath(link, fromProject);
    const text: MdNode = { type: "text", value: link.label };
    out.push(
      path
        ? {
            type: "link",
            url: linkHref(path),
            children: [text],
            data: { hProperties: { [WIKILINK_ATTR]: path } },
          }
        : // No owning project to resolve against: unresolved, so warning text.
          {
            type: "emphasis",
            children: [text],
            data: { hName: "span", hProperties: { className: [WIKILINK_MISSING_CLASS] } },
          },
    );
    last = at + match[0].length;
  }
  if (last === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(node: MdNode, fromProject: string | undefined): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const parts = splitText(child.value, fromProject);
      if (parts) {
        next.push(...parts);
        continue;
      }
    } else if (!SKIP.has(child.type)) {
      transform(child, fromProject);
    }
    next.push(child);
  }
  node.children = next;
}

/**
 * Remark plugin: rewrites `[[…]]` in mdast `text` nodes into links to the viewer route
 * (`/view/<project>/<path>.md`), or to the wiki tab for wiki pages. Code nodes carry `value`,
 * not text children, so fences and inline code stay verbatim.
 */
export default function remarkWikiLinks(options: { basePath?: string } = {}) {
  const fromProject = owningProject(options.basePath);
  return (tree: MdNode) => transform(tree, fromProject);
}
