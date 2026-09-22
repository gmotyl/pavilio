import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X, ArrowDown, ArrowUp } from "lucide-react";
import { preferences, type FileListSort } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

export type SortKey = "date" | "name";
export type SortDir = "asc" | "desc";

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

/**
 * The shape is checked here as well as parsed by the codec. `json` accepts any
 * well-formed JSON, so a hand-edited `{"sortKey":"size"}` — or a bare `null` —
 * would otherwise reach the pills as a sort nothing matches; the raw helper
 * validated the same two fields for the same reason.
 */
function isFileListSort(value: unknown): value is FileListSort {
  if (value === null || typeof value !== "object") return false;
  const { sortKey, sortDir } = value as Partial<FileListSort>;
  return (
    (sortKey === "date" || sortKey === "name") &&
    (sortDir === "asc" || sortDir === "desc")
  );
}

function readSort(): FileListSort {
  const stored = readPreference(preferences.fileListSort);
  return isFileListSort(stored) ? stored : preferences.fileListSort.default;
}

function writeSort(s: FileListSort) {
  writePreference(preferences.fileListSort, s);
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

  // Write on an actual change, never on mount. A write is a PATCH to the
  // committed workspace file now, not a `localStorage.setItem`, and
  // `FileListSidebar` is mounted by several tabs — so a mount-write put the
  // DECLARED DEFAULT into that file on a cold load and repeated it on ordinary
  // navigation. The ref carries what was last persisted (the value the
  // initializer read), so the first run has nothing to say.
  const persisted = useRef<FileListSort>(initial);
  useEffect(() => {
    if (persisted.current.sortKey === sortKey && persisted.current.sortDir === sortDir) return;
    persisted.current = { sortKey, sortDir };
    writeSort(persisted.current);
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
