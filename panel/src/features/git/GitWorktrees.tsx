import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GitFork } from "lucide-react";
import GitChanges from "./GitChanges";
import GitBranchDiff from "./GitBranchDiff";
import { type GitViewMode } from "./useGitViewMode";

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
          setExpanded((prev) => {
            const next = new Set(prev);
            for (const wt of data) {
              try {
                if (
                  localStorage.getItem(
                    `panel-worktree-expanded-${wt.path}`,
                  ) === "true"
                ) {
                  next.add(wt.path);
                }
              } catch {
                // ignore
              }
            }
            return next;
          });
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
  }, [qs]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const open = !prev.has(path);
      if (open) next.add(path);
      else next.delete(path);
      try {
        localStorage.setItem(
          `panel-worktree-expanded-${path}`,
          String(open),
        );
      } catch {
        // ignore
      }
      return next;
    });
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
        {worktrees.map((wt) => {
          const isOpen = expanded.has(wt.path);
          return (
            <div key={wt.path}>
              <div
                className="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-mono"
                style={{ background: "var(--bg-elevated)" }}
              >
                <button
                  type="button"
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
                  title={wt.path}
                >
                  {wt.path.replace(/^(\/Users\/|\/home\/)[^/]+\//, "~/")}
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
