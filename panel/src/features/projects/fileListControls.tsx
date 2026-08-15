import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Search, X, ArrowDown, ArrowUp } from "lucide-react";

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

const DEBOUNCE_MS = 200;

interface StoredSort {
  sortKey: SortKey;
  sortDir: SortDir;
}

function readSort(): StoredSort {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as StoredSort;
      if (
        (p.sortKey === "date" || p.sortKey === "name") &&
        (p.sortDir === "asc" || p.sortDir === "desc")
      ) {
        return p;
      }
    }
  } catch {
    // ignore parse / private-mode errors
  }
  return { sortKey: "date", sortDir: "desc" };
}

function writeSort(s: StoredSort) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / private-mode errors
  }
}

export interface FileListControls {
  debouncedQuery: string;
  sortKey: SortKey;
  sortDir: SortDir;
  controlsBar: ReactNode;
}

export function useFileListControls(): FileListControls {
  const [initial] = useState(readSort);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    writeSort({ sortKey, sortDir });
  }, [sortKey, sortDir]);

  const toggleDir = useCallback(
    () => setSortDir((d) => (d === "asc" ? "desc" : "asc")),
    [],
  );

  const pill = (key: SortKey, text: string) => (
    <button
      data-testid={`file-list-sort-${key}`}
      onClick={() => setSortKey(key)}
      className="px-1.5 py-0.5 rounded text-[11px] transition-colors"
      style={{
        background: sortKey === key ? "var(--bg-active)" : "transparent",
        color: sortKey === key ? "var(--text-primary)" : "var(--text-muted)",
      }}
    >
      {text}
    </button>
  );

  const controlsBar = (
    <div className="flex items-center gap-1 mb-2">
      <div
        className="flex items-center gap-1 flex-1 min-w-0 px-2 py-1 rounded-md"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        <Search size={12} style={{ color: "var(--text-muted)" }} className="shrink-0" />
        <input
          data-testid="file-list-filter-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files…"
          className="flex-1 min-w-0 bg-transparent outline-none text-xs"
          style={{ color: "var(--text-primary)" }}
        />
        {query && (
          <button
            data-testid="file-list-filter-clear"
            onClick={() => setQuery("")}
            title="Clear filter"
            className="shrink-0 p-0.5 rounded"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {pill("date", "Date")}
      {pill("name", "Name")}
      <button
        data-testid="file-list-sort-dir"
        onClick={toggleDir}
        title={sortDir === "asc" ? "Ascending" : "Descending"}
        className="shrink-0 p-1 rounded"
        style={{ color: "var(--text-muted)" }}
      >
        {sortDir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </button>
    </div>
  );

  return { debouncedQuery, sortKey, sortDir, controlsBar };
}

export default useFileListControls;
