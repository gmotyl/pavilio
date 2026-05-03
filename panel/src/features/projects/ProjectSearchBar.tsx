import { Search } from "lucide-react";
import GrepResultRow from "../search/GrepResultRow";
import type { GrepResult } from "../search/grep";
import type { RefObject } from "react";
import type { RepoSearchScope } from "./useRepoSearch";

interface Props {
  // Common
  projectName: string | undefined;
  query: string;
  onQueryChange: (next: string) => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement>;

  // Mode
  isReposSearch: boolean;

  // Non-repo search
  results: GrepResult[];
  loading: boolean;
  selectedIdx: number;
  onSelectedIdxChange: (idx: number) => void;
  onOpenResult: (path: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;

  // Repos search
  repoScope: RepoSearchScope;
  onRepoScopeChange: (scope: RepoSearchScope) => void;
  repoFilesCount: number;
  repoGrepResults: GrepResult[];
  repoGrepLoading: boolean;
  onOpenRepoResult: (result: GrepResult) => void;
}

const REPO_SCOPES: [RepoSearchScope, string][] = [
  ["changed", "Changed"],
  ["branch-diff", "Branch diff"],
  ["commits", "Commits"],
];

export function ProjectSearchBar({
  projectName,
  query,
  onQueryChange,
  onClose,
  inputRef,
  isReposSearch,
  results,
  loading,
  selectedIdx,
  onSelectedIdxChange,
  onOpenResult,
  onKeyDown,
  repoScope,
  onRepoScopeChange,
  repoFilesCount,
  repoGrepResults,
  repoGrepLoading,
  onOpenRepoResult,
}: Props) {
  return (
    <div className="mb-4">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <Search size={14} style={{ color: "var(--accent)" }} />
        {isReposSearch && (
          <div
            className="flex rounded overflow-hidden shrink-0"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            {REPO_SCOPES.map(([key, label], i) => (
              <button
                key={key}
                onClick={() => onRepoScopeChange(key)}
                className="text-[10px] px-1.5 py-0.5 transition-colors"
                style={{
                  background:
                    repoScope === key
                      ? "color-mix(in srgb, var(--accent) 20%, transparent)"
                      : "transparent",
                  color:
                    repoScope === key
                      ? "var(--accent)"
                      : "var(--text-muted)",
                  borderRight:
                    i < REPO_SCOPES.length - 1
                      ? "1px solid var(--border-subtle)"
                      : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={isReposSearch ? undefined : onKeyDown}
          placeholder={
            isReposSearch
              ? `Search in ${repoFilesCount} ${repoScope === "changed" ? "changed" : repoScope === "branch-diff" ? "diff" : "commit"} files...`
              : `Search in ${projectName ?? ""}...`
          }
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text-primary)" }}
          spellCheck={false}
          autoComplete="off"
        />
        {query && !isReposSearch && (
          <span
            className="text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            {results.length} results
          </span>
        )}
        {query && isReposSearch && !repoGrepLoading && (
          <span
            className="text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            {repoGrepResults.length} results
          </span>
        )}
        {query && isReposSearch && repoGrepLoading && (
          <span
            className="text-[11px] animate-pulse"
            style={{ color: "var(--text-muted)" }}
          >
            searching...
          </span>
        )}
        <button
          onClick={onClose}
          className="text-[11px] px-1.5 py-0.5 rounded"
          style={{ color: "var(--text-muted)" }}
        >
          ESC
        </button>
      </div>

      {!isReposSearch && loading && (
        <div
          className="mt-2 text-xs animate-pulse"
          style={{ color: "var(--text-tertiary)" }}
        >
          Searching...
        </div>
      )}

      {!isReposSearch &&
        !loading &&
        query.length >= 2 &&
        results.length > 0 && (
          <div
            className="mt-2 rounded-lg overflow-hidden"
            style={{
              border: "1px solid var(--border-subtle)",
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {results.map((result, i) => (
              <GrepResultRow
                key={result.relativePath}
                result={result}
                query={query}
                isSelected={i === selectedIdx}
                onClick={() => onOpenResult(result.relativePath)}
                onMouseEnter={() => onSelectedIdxChange(i)}
              />
            ))}
          </div>
        )}

      {!isReposSearch &&
        !loading &&
        query.length >= 2 &&
        results.length === 0 && (
          <div
            className="mt-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            No matches found
          </div>
        )}

      {isReposSearch && repoFilesCount === 0 && (
        <div
          className="mt-2 text-xs animate-pulse"
          style={{ color: "var(--text-tertiary)" }}
        >
          Loading file list...
        </div>
      )}

      {isReposSearch &&
        !repoGrepLoading &&
        query.length >= 2 &&
        repoGrepResults.length > 0 && (
          <div
            className="mt-2 rounded-lg overflow-hidden"
            style={{
              border: "1px solid var(--border-subtle)",
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {repoGrepResults.map((result, i) => (
              <GrepResultRow
                key={`${result.relativePath}-${i}`}
                result={result}
                query={query}
                isSelected={false}
                onClick={() => onOpenRepoResult(result)}
                onMouseEnter={() => {}}
              />
            ))}
          </div>
        )}

      {isReposSearch &&
        !repoGrepLoading &&
        query.length >= 2 &&
        repoGrepResults.length === 0 &&
        repoFilesCount > 0 && (
          <div
            className="mt-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            No matches in {repoFilesCount} {repoScope} files
          </div>
        )}
    </div>
  );
}

export default ProjectSearchBar;
