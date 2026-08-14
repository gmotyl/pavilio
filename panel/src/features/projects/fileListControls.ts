export type SortKey = "date" | "name";
export type SortDir = "asc" | "desc";

/** Global, shared across every tab and project — sort is a mode, not a per-list pref. */
export const SORT_STORAGE_KEY = "panel:fileList.sort";

export interface FilterSortOpts<T> {
  getName: (item: T) => string;
  getMtime: (item: T) => number;
  query: string;
  sortKey: SortKey;
  sortDir: SortDir;
}

/**
 * Case-insensitive substring filter on the displayed name, then a stable-enough
 * sort by mtime or name. Returns a new array; never mutates the input.
 */
export function filterAndSortFiles<T>(items: T[], opts: FilterSortOpts<T>): T[] {
  const { getName, getMtime, query, sortKey, sortDir } = opts;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) => getName(it).toLowerCase().includes(q))
    : items.slice();
  filtered.sort((a, b) => {
    const cmp =
      sortKey === "date"
        ? getMtime(a) - getMtime(b)
        : getName(a).localeCompare(getName(b), undefined, { sensitivity: "base" });
    return sortDir === "desc" ? -cmp : cmp;
  });
  return filtered;
}
