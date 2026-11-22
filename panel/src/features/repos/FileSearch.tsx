import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRepoGrep } from "./useRepoGrep";
import type { SearchMode, SearchRequest } from "./useSearchShortcut";
import "./Code.css";

const MAX_RESULTS = 50;

/** Subsequence match, case-insensitive; lower is better: unmatched span inside the match plus where it starts. */
export function fuzzyScore(path: string, query: string): number | null {
  const hay = path.toLowerCase();
  const needle = query.toLowerCase();
  let at = -1;
  let first = -1;
  for (const ch of needle) {
    at = hay.indexOf(ch, at + 1);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  return at - first + 1 - needle.length + first / 1000;
}

export function fuzzyFilter(paths: string[], query: string): string[] {
  if (!query) return [];
  const scored: [string, number][] = [];
  for (const p of paths) {
    const s = fuzzyScore(p, query);
    if (s !== null) scored.push([p, s]);
  }
  scored.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return scored.slice(0, MAX_RESULTS).map(([p]) => p);
}

export interface OpenRequest {
  line?: number;
  highlight?: string;
}

interface Props {
  /** The repo or worktree directory grep runs in. */
  root: string;
  paths: string[];
  request: SearchRequest | null;
  onRequestHandled: () => void;
  onOpen: (path: string, at?: OpenRequest) => void;
}

/** "Go to file" (fuzzy over the tree) and "Search in files" (grep) over one root. */
export default function FileSearch({ root, paths, request, onRequestHandled, onOpen }: Props) {
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    inputRef.current?.focus();
    inputRef.current?.select();
    onRequestHandled();
  }, [request, onRequestHandled]);

  const matches = useMemo(() => (mode === "files" ? fuzzyFilter(paths, query) : []), [mode, paths, query]);
  const grep = useRepoGrep(root, query, mode === "text");
  const hits = useMemo(
    () => grep.results.flatMap((r) => r.matches.map((m) => ({ path: r.relativePath, ...m }))),
    [grep.results],
  );

  useEffect(() => setActive(0), [query, mode]);

  const count = mode === "files" ? matches.length : hits.length;
  const openAt = (i: number) => {
    if (mode === "files") {
      const path = matches[i];
      if (path === undefined) return;
      setQuery("");
      onOpen(path);
    } else {
      const hit = hits[i];
      if (hit) onOpen(hit.path, { line: hit.line, highlight: query });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      openAt(active);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
    }
  };

  const label = mode === "files" ? "Go to file" : "Search in files";
  const showList = query !== "" && (mode === "files" || query.length >= 2);
  let index = 0;

  return (
    <div className="cv-search">
      <div className="cv-search-row">
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={`${label}…`}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className="cv-kbd">{mode === "files" ? "Ctrl+P" : "Ctrl+Shift+F"}</kbd>
        <button
          type="button"
          className="cv-search-mode"
          data-testid="code-search-mode"
          aria-pressed={mode === "text"}
          title="Search inside files (Ctrl+Shift+F)"
          onClick={() => {
            setMode((m) => (m === "files" ? "text" : "files"));
            inputRef.current?.focus();
          }}
        >
          In files
        </button>
      </div>
      {showList &&
        (mode === "files" ? (
          <ul id={listId} className="cv-results" role="listbox" aria-label="Matching files">
            {matches.length === 0 && <li className="cv-results-empty">No matching files.</li>}
            {matches.map((p, i) => (
              <li
                key={p}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openAt(i)}
              >
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <ul id={listId} className="cv-results" role="listbox" aria-label="Matches in files" aria-busy={grep.loading}>
            {!grep.loading && grep.results.length === 0 && <li className="cv-results-empty">No matches.</li>}
            {grep.results.map((r) => (
              <li key={r.relativePath} role="group" aria-label={r.relativePath}>
                <div className="cv-results-file" role="presentation">
                  {r.relativePath}
                </div>
                <ul role="presentation">
                  {r.matches.map((m) => {
                    const i = index++;
                    return (
                      <li
                        key={m.line}
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openAt(i)}
                      >
                        <span className="cv-results-ln">{m.line}</span>
                        <span className="cv-results-tx">{m.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
