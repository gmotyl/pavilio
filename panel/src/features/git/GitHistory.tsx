import { useState, useEffect, useMemo } from "react";
import {
  GitCommit,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Columns2,
  AlignJustify,
  Folder,
} from "lucide-react";
import DiffView, { type DiffMode } from "./DiffView";
import { buildFileTree, countFiles, type TreeNode } from "./file-tree";
import { useGitViewMode } from "./useGitViewMode";

interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

interface CommitFile {
  status: string;
  path: string;
}

interface GitHistoryProps {
  repo?: string;
  viewMode?: "flat" | "tree";
  commitsOpen?: boolean;
  onCommitsOpenChange?: (open: boolean) => void;
  /** Controlled active commit sha (for URL sync) */
  activeSha?: string | null;
  /** Controlled active file inside the commit */
  activeFile?: string | null;
  /** Notified when user selects or clears a sha */
  onActiveShaChange?: (sha: string | null) => void;
  /** Notified when user opens or closes a file within a commit */
  onActiveFileChange?: (file: string | null) => void;
}

function statusColor(s: string) {
  if (s === "A") return "var(--green)";
  if (s === "M") return "var(--yellow)";
  if (s === "D") return "var(--red)";
  if (s === "R") return "var(--blue)";
  return "var(--text-tertiary)";
}

function relativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function GitHistory({
  repo,
  viewMode: controlledViewMode,
  commitsOpen = true,
  onCommitsOpenChange,
  activeSha,
  activeFile,
  onActiveShaChange,
  onActiveFileChange,
}: GitHistoryProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeDiff, setActiveDiff] = useState<{
    sha: string;
    file: string;
  } | null>(null);
  const [diffContent, setDiffContent] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffMode>("inline");
  const [localViewMode] = useGitViewMode();
  const viewMode = controlledViewMode ?? localViewMode;
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  // Controlled/uncontrolled sync: when activeSha prop changes, mirror to internal state
  useEffect(() => {
    if (activeSha === undefined) return;
    setExpanded(activeSha ?? null);
    if (!activeSha) {
      setActiveDiff(null);
      setCommitFiles([]);
    }
  }, [activeSha]);

  // Controlled/uncontrolled sync: when activeFile prop changes, mirror to internal state
  useEffect(() => {
    if (activeFile === undefined) return;
    if (!activeFile) {
      setActiveDiff(null);
    } else if (activeSha) {
      setActiveDiff({ sha: activeSha, file: activeFile });
    }
  }, [activeFile, activeSha]);

  const qs = repo ? `&repo=${encodeURIComponent(repo)}` : "";

  useEffect(() => {
    fetch(`/api/git/log?limit=30${qs}`).then(async (res) => {
      if (res.ok) setCommits(await res.json());
    });
  }, [repo]);

  const toggleCommit = (sha: string) => {
    if (expanded === sha) {
      setExpanded(null);
      setActiveDiff(null);
      onActiveShaChange?.(null);
      onActiveFileChange?.(null);
      return;
    }
    setExpanded(sha);
    setActiveDiff(null);
    setCollapsedDirs(new Set());
    onActiveShaChange?.(sha);
    onActiveFileChange?.(null);
  };

  // Fetch files for the currently expanded commit. Reacts to both manual
  // toggle clicks and URL-driven expansion (?sha=<sha>).
  useEffect(() => {
    if (!expanded) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/git/commit-files?sha=${expanded}${qs}`);
        if (!cancelled && res.ok) setCommitFiles(await res.json());
      } catch {
        if (!cancelled) setCommitFiles([]);
      }
      if (!cancelled) setFilesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, qs]);

  const openDiff = async (sha: string, file: string) => {
    if (activeDiff?.sha === sha && activeDiff?.file === file) {
      setActiveDiff(null);
      onActiveFileChange?.(null);
      return;
    }
    setActiveDiff({ sha, file });
    onActiveFileChange?.(file);
    setDiffLoading(true);
    try {
      const res = await fetch(
        `/api/git/diff?sha=${sha}&file=${encodeURIComponent(file)}${qs}`,
      );
      if (res.ok) setDiffContent((await res.json()).diff);
      else setDiffContent("");
    } catch {
      setDiffContent("");
    }
    setDiffLoading(false);
  };

  const fileTree = useMemo(() => buildFileTree(commitFiles), [commitFiles]);

  const toggleDir = (path: string) => {
    const next = new Set(collapsedDirs);
    next.has(path) ? next.delete(path) : next.add(path);
    setCollapsedDirs(next);
  };

  const renderTreeNode = (
    node: TreeNode,
    sha: string,
    depth: number,
  ): React.ReactNode[] => {
    const items: React.ReactNode[] = [];
    const dirs = node.children
      .filter((c) => !c.file)
      .sort((a, b) => a.name.localeCompare(b.name));
    const nodeFiles = node.children
      .filter((c) => c.file)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const isCollapsed = collapsedDirs.has(dir.path);
      const fc = countFiles(dir);
      items.push(
        <button
          key={`dir-${dir.path}`}
          onClick={() => toggleDir(dir.path)}
          className="flex items-center gap-1.5 py-1 px-2 rounded w-full text-left transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          {isCollapsed ? (
            <ChevronRight size={11} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown size={11} style={{ color: "var(--text-muted)" }} />
          )}
          <Folder size={12} style={{ color: "var(--accent)", opacity: 0.7 }} />
          <span
            className="text-[12px] font-mono"
            style={{ color: "var(--text-secondary)" }}
          >
            {dir.name}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {fc}
          </span>
        </button>,
      );
      if (!isCollapsed) items.push(...renderTreeNode(dir, sha, depth + 1));
    }

    for (const child of nodeFiles) {
      const f = child.file!;
      items.push(
        <button
          key={f.path}
          onClick={() => openDiff(sha, f.path)}
          className="flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <span
            className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
            style={{ color: statusColor(f.status) }}
          >
            {f.status}
          </span>
          <span
            className="text-[12px] font-mono truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {child.name}
          </span>
        </button>,
      );
    }
    return items;
  };

  if (commits.length === 0) return null;

  // Full diff view for a file
  if (activeDiff) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => { setActiveDiff(null); onActiveFileChange?.(null); }}
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
            className="text-[11px] font-mono truncate flex-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {activeDiff.file}
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            {activeDiff.sha.slice(0, 7)}
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
            filename={activeDiff.file}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => onCommitsOpenChange?.(!commitsOpen)}
        className="flex items-center gap-1.5 mb-3 transition-colors"
        style={{ color: "var(--text-tertiary)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-secondary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-tertiary)")
        }
      >
        {commitsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-[11px] font-semibold uppercase tracking-widest">
          Recent Commits
        </span>
        <span
          className="text-[11px] normal-case tracking-normal"
          style={{ color: "var(--text-muted)" }}
        >
          {commits.length}
        </span>
      </button>
      {commitsOpen && (
        <div className="space-y-0.5">
          {commits.map((c) => (
            <div key={c.sha}>
              <button
                onClick={() => toggleCommit(c.sha)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    expanded === c.sha ? "var(--bg-elevated)" : "transparent")
                }
                style={{
                  background:
                    expanded === c.sha ? "var(--bg-elevated)" : "transparent",
                }}
              >
                {expanded === c.sha ? (
                  <ChevronDown
                    size={12}
                    className="shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  />
                ) : (
                  <ChevronRight
                    size={12}
                    className="shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  />
                )}
                <GitCommit
                  size={12}
                  className="shrink-0"
                  style={{ color: "var(--accent)" }}
                />
                <span
                  className="text-[11px] font-mono shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  {c.shortSha}
                </span>
                <span
                  className="text-[13px] truncate flex-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {c.message}
                </span>
                <span
                  className="text-[11px] shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  {relativeDate(c.date)}
                </span>
              </button>

              {/* Expanded: files changed */}
              {expanded === c.sha && (
                <div className="ml-6 mt-1 mb-2 space-y-0.5">
                  {filesLoading ? (
                    <p
                      className="text-xs px-2 py-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Loading files...
                    </p>
                  ) : commitFiles.length === 0 ? (
                    <p
                      className="text-xs px-2 py-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      No files (merge commit or root)
                    </p>
                  ) : viewMode === "tree" ? (
                    renderTreeNode(fileTree, c.sha, 0)
                  ) : (
                    commitFiles.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => openDiff(c.sha, f.path)}
                        className="flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors"
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--bg-hover)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <span
                          className="text-[11px] font-mono font-semibold w-4 text-center shrink-0"
                          style={{ color: statusColor(f.status) }}
                        >
                          {f.status}
                        </span>
                        <span
                          className="text-[12px] font-mono truncate"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {f.path}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
