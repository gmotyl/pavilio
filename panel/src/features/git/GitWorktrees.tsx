import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitFork } from "lucide-react";
import GitChanges from "./GitChanges";
import GitBranchDiff from "./GitBranchDiff";
import { type GitViewMode } from "./useGitViewMode";
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";
import { asPreferenceScope, isPreferenceScope } from "../../preferences/types";

interface Worktree {
  path: string;
  head: string;
  branch: string | null;
}

interface Props {
  repo?: string;
  viewMode?: GitViewMode;
  onViewModeChange?: (mode: GitViewMode) => void;
}

export default function GitWorktrees({
  repo,
  viewMode,
  onViewModeChange,
}: Props) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [branch, setBranch] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /**
   * The latest expanded set, updated synchronously by every path that changes
   * it — before React has re-rendered. Two toggles of the SAME worktree in one
   * tick both read this rather than the render closure, so the second sees the
   * first's result and the pair cancels. Deriving the written value from the
   * closure instead is the regression this ref exists to prevent: both clicks
   * compute "open", the pane ends expanded, and `true` is written twice.
   *
   * It is the same shape `usePreference` keeps for its own setter; this hook
   * cannot use that one because the number of worktrees is dynamic.
   */
  const latest = useRef(expanded);

  const adopt = useCallback((next: Set<string>) => {
    latest.current = next;
    setExpanded(next);
  }, []);

  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wtRes, brRes] = await Promise.all([
          fetch(`/api/git/worktrees${qs}`),
          fetch(`/api/git/branch${qs}`),
        ]);
        if (!cancelled && wtRes.ok) {
          const data: Worktree[] = await wtRes.json();
          setWorktrees(data);
          // A worktree path is the SCOPE, never part of the key, so
          // `~/git/prv/pavilio` and the absolute path `git worktree list`
          // prints normalize onto one entry. A path that is missing or blank is
          // not a scope — the store would refuse it — so it stays collapsed.
          const stored = data
            .filter((wt) => isPreferenceScope(wt.path))
            .filter((wt) => readPreference(preferences.worktreeExpanded, wt.path))
            .map((wt) => wt.path);
          const next = new Set(latest.current);
          for (const path of stored) next.add(path);
          adopt(next);
        }
        if (!cancelled && brRes.ok) {
          const data = await brRes.json();
          setBranch(data.branch ?? "");
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs, adopt]);

  const toggle = (path: string) => {
    // From the LATEST set, never the render closure — see `latest` above. The
    // updater stays pure because there is no updater: the next set is computed
    // here and adopted, so the value written and the value rendered are the
    // same one.
    const open = !latest.current.has(path);
    const next = new Set(latest.current);
    if (open) next.add(path);
    else next.delete(path);
    adopt(next);
    // A missing or blank path is not a scope: it toggles on screen and is
    // forgotten on reload, rather than putting every such worktree on one key.
    const scope = asPreferenceScope(path);
    if (scope !== undefined) {
      writePreference(preferences.worktreeExpanded, open, scope);
    }
  };

  if (worktrees.length <= 1) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <GitFork size={12} style={{ color: "var(--text-tertiary)" }} />
        <span
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Worktrees
        </span>
      </div>
      <div className="space-y-1">
        {worktrees.map((wt, index) => {
          const isOpen = expanded.has(wt.path);
          // Same class as the scope guards: a path that never arrived must not
          // be handed to a string method during render.
          const label = typeof wt.path === "string" ? wt.path : "";
          return (
            <div key={wt.path ?? `missing-path-${index}`}>
              <div
                className="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-mono"
                style={{ background: "var(--bg-elevated)" }}
              >
                <button
                  type="button"
                  data-testid={`git-worktree-toggle-${wt.path}`}
                  onClick={() => toggle(wt.path)}
                  className="w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-label={isOpen ? "Collapse worktree" : "Expand worktree"}
                >
                  {isOpen ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </button>
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono"
                  style={{
                    background: "var(--bg-base)",
                    color:
                      wt.branch === branch
                        ? "var(--accent)"
                        : "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {wt.branch ?? "(detached)"}
                </span>
                <span
                  className="truncate"
                  style={{ color: "var(--text-muted)" }}
                  title={label}
                >
                  {label.replace(/^(\/Users\/|\/home\/)[^/]+\//, "~/")}
                </span>
              </div>
              {isOpen && (
                <div className="ml-6 mt-1 mb-2 space-y-3">
                  <GitChanges
                    repo={wt.path}
                    nested
                    viewMode={viewMode}
                    onViewModeChange={onViewModeChange}
                  />
                  <div
                    className="pt-3"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <GitBranchDiff
                      repo={wt.path}
                      viewMode={viewMode}
                      onViewModeChange={onViewModeChange}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
