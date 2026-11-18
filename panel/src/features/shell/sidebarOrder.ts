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

/**
 * Group names are free text, so a name like `toString` or `__proto__` must never
 * resolve through Object.prototype: read own keys only, and build maps without a
 * prototype so assignment cannot reach it either.
 */
export const ownList = (
  rec: Record<string, string[]>,
  key: string,
): string[] | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);
export const ownFlag = (rec: Record<string, boolean>, key: string): boolean =>
  Object.hasOwn(rec, key) && rec[key] === true;
export const groupMap = <T>(): Record<string, T> =>
  Object.create(null) as Record<string, T>;

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
          members: ordered(ownList(order.groups, name) ?? [], members.get(name) ?? []),
        }
      : { kind: "project", name };
  });
}

/**
 * Rename a group in the saved order. When `to` already exists the two merge
 * deterministically: member lists concatenate (`to`'s first, deduped) and the
 * top list keeps one `g:<to>` entry, at its first position.
 */
export function renameGroupInOrder(
  order: SidebarOrder,
  from: string,
  to: string,
): SidebarOrder {
  if (from === to) return order;
  const top = [
    ...new Set(order.top.map((k) => (k === `g:${from}` ? `g:${to}` : k))),
  ];
  const groups = groupMap<string[]>();
  for (const [g, m] of Object.entries(order.groups)) {
    if (g !== from) groups[g] = m;
  }
  if (Object.hasOwn(order.groups, from) || Object.hasOwn(order.groups, to)) {
    groups[to] = [
      ...new Set([
        ...(ownList(order.groups, to) ?? []),
        ...(ownList(order.groups, from) ?? []),
      ]),
    ];
  }
  return { top, groups };
}

/**
 * The `groupCollapsed` half of a rename: the collapse flag follows the group.
 * When `to` already has a flag, it is kept.
 */
export function renameGroupCollapsed(
  collapsed: Record<string, boolean>,
  from: string,
  to: string,
): Record<string, boolean> {
  if (from === to) return collapsed;
  const next = groupMap<boolean>();
  for (const [g, v] of Object.entries(collapsed)) if (g !== from) next[g] = v;
  if (!Object.hasOwn(next, to) && Object.hasOwn(collapsed, from))
    next[to] = collapsed[from];
  return next;
}
