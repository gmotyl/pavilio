import { mergeSidebarOrder, type SidebarOrder } from "../shell/sidebarOrder";

export const FAVOURITES = "Favourites";
export const OTHER = "Other";

export interface Section<T extends { name: string }> {
  /** Section label, also the value stored as the selected chip. */
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
  // Saved order first; starred projects it does not name follow as listed.
  const orderedStarred = [
    ...new Set(starredOrder.filter((n) => starredNames.has(n))),
  ];
  const seen = new Set(orderedStarred);
  for (const p of starred) if (!seen.has(p.name)) orderedStarred.push(p.name);

  const out: Section<T>[] = [
    {
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
        name: node.name,
        kind: "group",
        projects: node.members.map((n) => byName.get(n)!),
      });
    } else if (!starredNames.has(node.name)) {
      other.push(byName.get(node.name)!);
    }
  }
  out.push({ name: OTHER, kind: "other", projects: other });
  return out.filter((s) => s.projects.length > 0);
}
