import { mergeSidebarOrder, type SidebarOrder } from "../shell/sidebarOrder";
import { orderStarred } from "../shell/starredOrder";

export const FAVOURITES = "Favourites";
export const OTHER = "Other";
export const FAVOURITES_KEY = "fav";
export const OTHER_KEY = "other";
export const groupKey = (name: string) => `group:${name}`;

/**
 * Resolve a stored chip to a section key. Values stored before keys existed
 * were plain group names; those still select that group, anything else is All.
 */
export function resolveFilter(
  stored: string | null,
  sections: readonly { key: string; kind: string; name: string }[],
): string | null {
  if (stored === null) return null;
  if (sections.some((s) => s.key === stored)) return stored;
  return sections.find((s) => s.kind === "group" && s.name === stored)?.key ?? null;
}

export interface Section<T extends { name: string }> {
  /** Filter identity (`fav`, `other`, `group:<name>`): unlike `name`, it cannot collide. */
  key: string;
  /** Display label only. */
  name: string;
  kind: "favourites" | "group" | "other";
  projects: T[];
}

/**
 * Home page sections: Favourites (starred, in `starredOrder`), each group in
 * sidebar order with members in sidebar order, then Other (ungrouped and not
 * starred). A starred project with a group is listed in both. Empty sections
 * are dropped.
 */
export function buildSections<T extends { name: string; group?: string | null }>({
  projects,
  favorites,
  starredOrder,
  sidebarOrder,
}: {
  projects: T[];
  favorites: ReadonlySet<string>;
  starredOrder: readonly string[];
  sidebarOrder: SidebarOrder;
}): Section<T>[] {
  const byName = new Map(projects.map((p) => [p.name, p]));
  const starred = projects.filter((p) => favorites.has(p.name));
  const starredNames = new Set(starred.map((p) => p.name));
  const orderedStarred = orderStarred(
    starredOrder,
    starred.map((p) => p.name),
  );

  const out: Section<T>[] = [
    {
      key: FAVOURITES_KEY,
      name: FAVOURITES,
      kind: "favourites",
      projects: orderedStarred.map((n) => byName.get(n)!),
    },
  ];
  const other: T[] = [];
  const tree = mergeSidebarOrder(
    sidebarOrder,
    projects.map((p) => ({ name: p.name, group: p.group || null })),
  );
  for (const node of tree) {
    if (node.kind === "group") {
      out.push({
        key: groupKey(node.name),
        name: node.name,
        kind: "group",
        projects: node.members.map((n) => byName.get(n)!),
      });
    } else if (!starredNames.has(node.name)) {
      other.push(byName.get(node.name)!);
    }
  }
  out.push({ key: OTHER_KEY, name: OTHER, kind: "other", projects: other });
  return out.filter((s) => s.projects.length > 0);
}
