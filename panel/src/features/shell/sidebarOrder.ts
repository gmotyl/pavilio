/**
 * Pure merge of the saved sidebar order (a portable preference) with what
 * project discovery reports. Discovery is the truth for membership: stale
 * entries are skipped, newcomers append alphabetically after the ordered items
 * at their level, and a project's current `group:` wins over where it was saved.
 */
export type SidebarOrder = {
  top: string[] /* "g:<group>" | "p:<project>" */;
  groups: Record<string, string[]>;
};
export type SidebarNode =
  | { kind: "group"; name: string; members: string[] }
  | { kind: "project"; name: string };

const byName = (a: string, b: string) => a.localeCompare(b);

/** Saved names first (if still present), then the rest alphabetically. */
function ordered(
  saved: readonly string[],
  present: readonly string[],
): string[] {
  const set = new Set(present);
  const head = [...new Set(saved)].filter((n) => set.has(n));
  const seen = new Set(head);
  return [...head, ...present.filter((n) => !seen.has(n)).sort(byName)];
}

export function mergeSidebarOrder(
  order: SidebarOrder,
  projects: { name: string; group: string | null }[],
): SidebarNode[] {
  const members = new Map<string, string[]>();
  const loose: string[] = [];
  for (const p of projects) {
    if (p.group)
      members.set(p.group, [...(members.get(p.group) ?? []), p.name]);
    else loose.push(p.name);
  }
  const keys = [
    ...[...members.keys()].map((g) => `g:${g}`),
    ...loose.map((p) => `p:${p}`),
  ];
  const set = new Set(keys);
  const head = [...new Set(order.top)].filter((k) => set.has(k));
  const seen = new Set(head);
  const tail = keys
    .filter((k) => !seen.has(k))
    .sort((a, b) => byName(a.slice(2), b.slice(2)));
  return [...head, ...tail].map((k): SidebarNode => {
    const name = k.slice(2);
    return k.startsWith("g:")
      ? {
          kind: "group",
          name,
          members: ordered(order.groups[name] ?? [], members.get(name) ?? []),
        }
      : { kind: "project", name };
  });
}

export function renameGroupInOrder(
  order: SidebarOrder,
  from: string,
  to: string,
): SidebarOrder {
  return {
    top: order.top.map((k) => (k === `g:${from}` ? `g:${to}` : k)),
    groups: Object.fromEntries(
      Object.entries(order.groups).map(([g, m]) => [g === from ? to : g, m]),
    ),
  };
}

/** The `groupCollapsed` half of a rename: the collapse flag follows the group. */
export function renameGroupCollapsed(
  collapsed: Record<string, boolean>,
  from: string,
  to: string,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(collapsed).map(([g, v]) => [g === from ? to : g, v]),
  );
}
