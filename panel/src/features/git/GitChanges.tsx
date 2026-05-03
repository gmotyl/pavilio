import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  GitBranch,
  Upload,
  Check,
  ExternalLink,
  ArrowLeft,
  Columns2,
  AlignJustify,
  List,
  FolderTree,
  ChevronRight,
  ChevronDown,
  Folder,
} from "lucide-react";
import DiffView, { type DiffMode } from "./DiffView";
import BranchPicker from "./BranchPicker";
import { buildFileTree, countFiles, type TreeNode } from "./file-tree";
import { useGitViewMode, type GitViewMode } from "./useGitViewMode";

interface GitFile {
  status: string;
  path: string;
}

interface GitChangesProps {
  /** Absolute repo path, or undefined for the workspace repo */
  repo?: string;
  /** Repo display name */
  title?: string;
  /** Show commit/push controls */
  showCommit?: boolean;
  /** Controlled view mode from parent */
  viewMode?: GitViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: GitViewMode) => void;
  /** Extra actions to render next to the commit buttons */
  extraActions?: ReactNode;
  /** Filter displayed files by path substring */
  fileFilter?: string;
  /** When set, auto-open the diff for this file path */
  openFile?: string | null;
  /** Text to highlight in the diff view */
  highlight?: string;
  /** When set, called when the user opens or closes a diff (parent can mirror to URL) */
  onOpenFileChange?: (file: string | null) => void;
  /** When true, render a file list alongside the diff instead of replacing it. */
  showListSidebar?: boolean;
  /** When true, render a compact nested view (no branch picker, commit form, worktrees, or sub-sidebar). */
  nested?: boolean;
}

export function statusLabel(s: string) {
  if (s === "??") return "U";
  if (s === "M") return "M";
  if (s === "D") return "D";
  if (s === "A") return "A";
  return s;
}

export function statusColor(s: string) {
  if (s === "??") return "var(--green)";
  if (s === "M") return "var(--yellow)";
  if (s === "D") return "var(--red)";
  return "var(--text-tertiary)";
}

export default function GitChanges({
  repo,
  title,
  showCommit = true,
  viewMode: controlledViewMode,
  onViewModeChange,
  extraActions,
  fileFilter,
  openFile,
  highlight,
  onOpenFileChange,
  showListSidebar = false,
  nested = false,
}: GitChangesProps) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState("");
  const [diffMode, setDiffMode] = useState<DiffMode>("inline");
  const [diffLoading, setDiffLoading] = useState(false);

  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";

  const fetchStatus = async () => {
    const [statusRes, branchRes, suggestRes] = await Promise.all([
      fetch(`/api/git/status${qs}`),
      fetch(`/api/git/branch${qs}`),
      fetch(`/api/git/suggest-message${qs}`),
    ]);
    if (statusRes.ok) setFiles(await statusRes.json());
    if (branchRes.ok) setBranch((await branchRes.json()).branch);
    if (suggestRes.ok) setSuggestion((await suggestRes.json()).suggestion);
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch(`/api/git/branches${qs}`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches);
      }
    } catch {}
  };

  const handleCheckout = async (targetBranch: string) => {
    if (targetBranch === branch) return;
    setCheckoutError("");
    setLoading("switching");
    try {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: targetBranch, repo }),
      });
      const data = await res.json();
      if (res.ok) {
        setBranch(data.branch);
        await fetchStatus();
        await fetchBranches();
      } else {
        setCheckoutError(data.error);
      }
    } catch (e: any) {
      setCheckoutError(e.message || "Checkout failed");
    }
    setLoading("");
  };

  useEffect(() => {
    fetchStatus();
    fetchBranches();
  }, [repo]);
  useEffect(() => {
    setCommitMsg(suggestion);
  }, [suggestion]);

  const toggleFile = (path: string) => {
    const next = new Set(selected);
    next.has(path) ? next.delete(path) : next.add(path);
    setSelected(next);
  };

  const openDiff = async (path: string) => {
    setActiveDiff(path);
    onOpenFileChange?.(path);
    setDiffLoading(true);
    try {
      const res = await fetch(
        `/api/git/diff?file=${encodeURIComponent(path)}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`,
      );
      if (res.ok) setDiffContent((await res.json()).diff);
    } catch {
      setDiffContent("");
    }
    setDiffLoading(false);
  };

  // External trigger to open a specific file diff
  useEffect(() => {
    if (openFile && files.some((f) => f.path === openFile)) {
      if (activeDiff !== openFile) openDiff(openFile);
    } else if (!openFile && activeDiff) {
      setActiveDiff(null);
    }
  }, [openFile, files]);

  const stageFiles = async (filesToStage: string[]) => {
    setLoading("staging");
    await fetch("/api/git/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: filesToStage, repo }),
    });
    setSelected(new Set());
    await fetchStatus();
    setLoading("");
  };

  const commit = async (push = false) => {
    if (!commitMsg.trim()) return;
    setLoading("committing");
    await fetch("/api/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: commitMsg, repo }),
    });
    if (push) {
      setLoading("pushing");
      await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
    }
    setCommitMsg("");
    setActiveDiff(null);
    await fetchStatus();
    setLoading("");
  };

  const [localViewMode, setLocalViewMode] = useGitViewMode();
  const viewMode = controlledViewMode ?? localViewMode;
  const setViewMode = onViewModeChange ?? setLocalViewMode;
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const isDimmed = (path: string) => path.endsWith(".DS_Store");

  const displayFiles = useMemo(
    () =>
      fileFilter
        ? files.filter((f) =>
            f.path.toLowerCase().includes(fileFilter.toLowerCase()),
          )
        : files,
    [files, fileFilter],
  );

  const fileTree = useMemo(() => buildFileTree(displayFiles), [displayFiles]);

  const toggleDir = (path: string) => {
    const next = new Set(collapsedDirs);
    next.has(path) ? next.delete(path) : next.add(path);
    setCollapsedDirs(next);
  };

  const renderTreeNode = (
    node: TreeNode,
    depth: number,
    compact = false,
  ): React.ReactNode[] => {
    const items: React.ReactNode[] = [];
    const indent = compact ? depth * 12 + 8 : depth * 16 + 8;
    // Sort: dirs first, then files
    const dirs = node.children
      .filter((c) => !c.file)
      .sort((a, b) => a.name.localeCompare(b.name));
    const nodeFiles = node.children
      .filter((c) => c.file)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const isCollapsed = collapsedDirs.has(dir.path);
      const fileCount = countFiles(dir);
      items.push(
        <button
          key={`dir-${dir.path}`}
          onClick={() => toggleDir(dir.path)}
          className="flex items-center gap-1.5 py-1 px-2 rounded-md w-full text-left transition-colors"
          style={{ paddingLeft: `${indent}px` }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          {isCollapsed ? (
            <ChevronRight
              size={compact ? 11 : 12}
              style={{ color: "var(--text-muted)" }}
            />
          ) : (
            <ChevronDown
              size={compact ? 11 : 12}
              style={{ color: "var(--text-muted)" }}
            />
          )}
          <Folder
            size={compact ? 12 : 13}
            style={{ color: "var(--accent)", opacity: 0.7 }}
          />
          <span
            className={`${compact ? "text-[12px]" : "text-[13px]"} font-mono${compact ? " truncate" : ""}`}
            style={{ color: "var(--text-secondary)" }}
          >
            {dir.name}
          </span>
          <span
            className={compact ? "text-[10px]" : "text-[11px]"}
            style={{ color: "var(--text-muted)" }}
          >
            {fileCount}
          </span>
        </button>,
      );
      if (!isCollapsed)
        items.push(...renderTreeNode(dir, depth + 1, compact));
    }

    for (const child of nodeFiles) {
      const f = child.file!;
      const isActive = activeDiff === f.path;

      if (compact) {
        items.push(
          <button
            key={f.path}
            onClick={() => openDiff(f.path)}
            className={`flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors ${isDimmed(f.path) ? "opacity-35" : ""}`}
            style={{
              paddingLeft: `${indent}px`,
              background: isActive ? "var(--bg-active)" : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
              style={{ color: statusColor(f.status) }}
            >
              {statusLabel(f.status)}
            </span>
            <span
              className="text-[12px] font-mono truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {child.name}
            </span>
          </button>,
        );
        continue;
      }

      items.push(
        <div
          key={f.path}
          className={`flex items-center gap-2 py-1.5 px-2 rounded-md group transition-colors ${isDimmed(f.path) ? "opacity-35" : ""}`}
          style={{
            paddingLeft: `${indent}px`,
            background: isActive ? "var(--bg-active)" : undefined,
          }}
          onMouseEnter={(e) => {
            if (!isActive)
              e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!isActive) e.currentTarget.style.background = "transparent";
          }}
        >
          {showCommit && (
            <input
              type="checkbox"
              checked={selected.has(f.path)}
              onChange={() => toggleFile(f.path)}
              className="shrink-0"
            />
          )}
          <span
            className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
            style={{ color: statusColor(f.status) }}
          >
            {statusLabel(f.status)}
          </span>
          <button
            onClick={() => openDiff(f.path)}
            className="text-[13px] font-mono truncate flex-1 text-left"
            style={{ color: "var(--text-secondary)" }}
          >
            {child.name}
          </button>
          {!repo && f.path.startsWith("projects/") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(
                  `/view/${f.path.replace(/^projects\//, "")}`,
                  "_self",
                );
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
              style={{ color: "var(--text-tertiary)" }}
              title="Open file"
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>,
      );
    }
    return items;
  };

  const renderFlatFileRow = (f: GitFile, compact = false) => {
    const isActive = activeDiff === f.path;
    if (compact) {
      return (
        <button
          key={f.path}
          onClick={() => openDiff(f.path)}
          className={`flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors ${isDimmed(f.path) ? "opacity-35" : ""}`}
          style={{ background: isActive ? "var(--bg-active)" : undefined }}
          onMouseEnter={(e) => {
            if (!isActive)
              e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!isActive) e.currentTarget.style.background = "transparent";
          }}
        >
          <span
            className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
            style={{ color: statusColor(f.status) }}
          >
            {statusLabel(f.status)}
          </span>
          <span
            className="text-[12px] font-mono truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {f.path}
          </span>
        </button>
      );
    }
    return (
      <div
        key={f.path}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md group transition-colors ${isDimmed(f.path) ? "opacity-35" : ""}`}
        style={{ background: isActive ? "var(--bg-active)" : undefined }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = "transparent";
        }}
      >
        {showCommit && (
          <input
            type="checkbox"
            checked={selected.has(f.path)}
            onChange={() => toggleFile(f.path)}
            className="shrink-0"
          />
        )}
        <span
          className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
          style={{ color: statusColor(f.status) }}
        >
          {statusLabel(f.status)}
        </span>
        <button
          onClick={() => openDiff(f.path)}
          className="text-[13px] font-mono truncate flex-1 text-left"
          style={{ color: "var(--text-secondary)" }}
        >
          {f.path}
        </button>
        {!repo && f.path.startsWith("projects/") && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                `/view/${f.path.replace(/^projects\//, "")}`,
                "_self",
              );
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
            style={{ color: "var(--text-tertiary)" }}
            title="Open file"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    );
  };

  const renderSidebarList = () => (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div
          className="text-[11px] font-semibold uppercase tracking-widest flex-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Changed ({displayFiles.length})
        </div>
        <button
          type="button"
          onClick={() => setViewMode("flat")}
          className="p-1 rounded"
          style={{
            color: viewMode === "flat" ? "var(--accent)" : "var(--text-tertiary)",
            background: viewMode === "flat" ? "var(--bg-hover)" : "transparent",
          }}
          title="Flat list"
        >
          <AlignJustify size={12} />
        </button>
        <button
          type="button"
          onClick={() => setViewMode("tree")}
          className="p-1 rounded"
          style={{
            color: viewMode === "tree" ? "var(--accent)" : "var(--text-tertiary)",
            background: viewMode === "tree" ? "var(--bg-hover)" : "transparent",
          }}
          title="Tree"
        >
          <FolderTree size={12} />
        </button>
      </div>
      <div className="space-y-0.5">
        {viewMode === "tree"
          ? renderTreeNode(fileTree, 0, true)
          : displayFiles.map((f) => renderFlatFileRow(f, true))}
      </div>
    </div>
  );

  // Diff detail view
  if (activeDiff) {
    const diffEl = (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => {
              setActiveDiff(null);
              onOpenFileChange?.(null);
            }}
            className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span
            className="text-sm font-mono flex-1 truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {activeDiff}
          </span>
          <div
            className="flex rounded-md overflow-hidden"
            style={{ border: "1px solid var(--border-default)" }}
          >
            <button
              onClick={() => setDiffMode("inline")}
              className="p-1.5 transition-colors"
              style={{
                background:
                  diffMode === "inline" ? "var(--bg-active)" : "transparent",
                color:
                  diffMode === "inline"
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
              }}
              title="Inline diff"
            >
              <AlignJustify size={14} />
            </button>
            <button
              onClick={() => setDiffMode("side-by-side")}
              className="p-1.5 transition-colors"
              style={{
                background:
                  diffMode === "side-by-side"
                    ? "var(--bg-active)"
                    : "transparent",
                color:
                  diffMode === "side-by-side"
                    ? "var(--text-primary)"
                    : "var(--text-tertiary)",
                borderLeft: "1px solid var(--border-default)",
              }}
              title="Side by side"
            >
              <Columns2 size={14} />
            </button>
          </div>
        </div>
        {diffLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading diff...
          </p>
        ) : (
          <DiffView
            diff={diffContent}
            mode={diffMode}
            filename={activeDiff}
            highlight={highlight}
          />
        )}
      </div>
    );

    if (showListSidebar && !nested) {
      return (
        <div className="md:flex md:gap-4">
          <aside
            className="hidden md:block w-[240px] shrink-0 self-start sticky top-4 max-h-[calc(100vh-120px)] overflow-y-auto rounded-lg p-2"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {renderSidebarList()}
          </aside>
          <div className="flex-1 min-w-0">{diffEl}</div>
        </div>
      );
    }
    return diffEl;
  }

  return (
    <div>
      {/* Header */}
      {!nested && (
        <div className="flex items-center gap-3 mb-4">
          <GitBranch
            className="w-4 h-4"
            style={{ color: "var(--text-tertiary)" }}
          />
          {title && <span className="text-sm font-semibold">{title}</span>}
          {branch && (
            <BranchPicker
              branches={branches}
              value={branch}
              onChange={handleCheckout}
              align="left"
              triggerClassName="text-xs px-2 py-0.5 rounded-full font-mono cursor-pointer flex items-center gap-1 transition-colors"
              triggerStyle={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
              trigger={<>{loading === "switching" ? "switching..." : branch}</>}
            />
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {displayFiles.length}
            {fileFilter && displayFiles.length !== files.length
              ? `/${files.length}`
              : ""}{" "}
            changed
          </span>
          {displayFiles.length > 0 && (
            <div
              className="flex rounded-md overflow-hidden ml-auto"
              style={{ border: "1px solid var(--border-default)" }}
            >
              <button
                onClick={() => setViewMode("flat")}
                className="p-1 transition-colors"
                style={{
                  background:
                    viewMode === "flat" ? "var(--bg-active)" : "transparent",
                  color:
                    viewMode === "flat"
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                }}
                title="Flat list"
              >
                <List size={13} />
              </button>
              <button
                onClick={() => setViewMode("tree")}
                className="p-1 transition-colors"
                style={{
                  background:
                    viewMode === "tree" ? "var(--bg-active)" : "transparent",
                  color:
                    viewMode === "tree"
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                  borderLeft: "1px solid var(--border-default)",
                }}
                title="Tree view"
              >
                <FolderTree size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {checkoutError && (() => {
        const wtMatch = checkoutError.match(/already checked out at '([^']+)'/i)
          || checkoutError.match(/is already used by worktree at '([^']+)'/i);
        const wtPath = wtMatch?.[1];
        return (
          <div
            className="mb-4 rounded-lg p-3 text-[12px] font-mono whitespace-pre-wrap"
            style={{
              background: wtPath
                ? "color-mix(in srgb, var(--yellow) 8%, transparent)"
                : "color-mix(in srgb, var(--red) 10%, transparent)",
              border: `1px solid color-mix(in srgb, ${wtPath ? "var(--yellow)" : "var(--red)"} 30%, transparent)`,
              color: wtPath ? "var(--yellow)" : "var(--red)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider font-sans">
                {wtPath ? "Branch in use by worktree" : "Checkout failed"}
              </span>
              <button
                onClick={() => setCheckoutError("")}
                className="text-[11px] font-sans px-1.5 py-0.5 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-primary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-muted)")
                }
              >
                dismiss
              </button>
            </div>
            {wtPath
              ? <span className="font-sans text-[12px]" style={{ color: "var(--text-secondary)" }}>This branch is checked out in a worktree at <span className="font-mono">{wtPath}</span></span>
              : checkoutError}
          </div>
        );
      })()}

      {displayFiles.length === 0 && !fileFilter ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No changes
        </p>
      ) : displayFiles.length === 0 && fileFilter ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No matching files
        </p>
      ) : (
        <>
          {/* File list */}
          <div className="space-y-0.5 mb-4">
            {viewMode === "flat"
              ? displayFiles.map((f) => renderFlatFileRow(f))
              : renderTreeNode(fileTree, 0)}
          </div>

          {/* Stage + Commit */}
          {!nested && showCommit && (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => stageFiles([...selected])}
                  disabled={selected.size === 0 || !!loading}
                  className="px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-30"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Stage selected ({selected.size})
                </button>
                <button
                  onClick={() => stageFiles(files.map((f) => f.path))}
                  disabled={!!loading}
                  className="px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-30"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Stage all
                </button>
              </div>

              <div
                className="pt-4"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <textarea
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message..."
                  className="w-full rounded-lg p-3 text-sm font-mono resize-none h-20 focus:outline-none transition-colors"
                  style={{
                    background: "var(--bg-base)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor =
                      "var(--border-default)")
                  }
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => commit(false)}
                    disabled={!commitMsg.trim() || !!loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md font-medium transition-colors disabled:opacity-30"
                    style={{
                      background: "var(--accent)",
                      color: "var(--bg-base)",
                    }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Commit
                  </button>
                  <button
                    onClick={() => commit(true)}
                    disabled={!commitMsg.trim() || !!loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-colors disabled:opacity-30"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Commit & Push
                  </button>
                  {extraActions && (
                    <div className="ml-auto">{extraActions}</div>
                  )}
                </div>
                {loading && (
                  <p
                    className="text-xs mt-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {loading}...
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
