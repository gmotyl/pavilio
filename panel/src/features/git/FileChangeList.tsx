import { useState, useMemo, type ReactNode } from "react";
import {
  AlignJustify,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
} from "lucide-react";
import { buildFileTree, countFiles, type TreeNode } from "./file-tree";
import type { GitViewMode } from "./useGitViewMode";

export interface FileChange {
  status: string;
  path: string;
}

export function statusColor(s: string): string {
  if (s === "A") return "var(--green)";
  if (s === "M") return "var(--yellow)";
  if (s === "D") return "var(--red)";
  if (s === "R") return "var(--blue)";
  return "var(--text-tertiary)";
}

interface Props {
  files: FileChange[];
  activeFile?: string | null;
  onFileClick: (path: string) => void;
  viewMode: GitViewMode;
  onViewModeChange?: (mode: GitViewMode) => void;
  /** Override header label (default "Changed"). */
  headerLabel?: string;
  /** Optional content rendered above the list (e.g. a commit subject). */
  headerExtra?: ReactNode;
  /** Use tighter indentation suitable for a narrow sidebar. */
  compact?: boolean;
  /** Hide the entire header strip (label + view toggle). */
  hideHeader?: boolean;
}

/**
 * Shared file-change list with flat/tree toggle. Used in the diff sidebar
 * of working-tree changes, branch diff, and per-commit history. Keeps
 * collapsed-dir state local — there's no use case yet for syncing it
 * across surfaces.
 */
export function FileChangeList({
  files,
  activeFile,
  onFileClick,
  viewMode,
  onViewModeChange,
  headerLabel = "Changed",
  headerExtra,
  compact = false,
  hideHeader = false,
}: Props) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    () => new Set(),
  );
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const toggleDir = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const indentFor = (depth: number) =>
    compact ? depth * 12 + 8 : depth * 16 + 8;

  const renderFlatRow = (f: FileChange) => {
    const isActive = activeFile === f.path;
    return (
      <button
        key={f.path}
        onClick={() => onFileClick(f.path)}
        className="flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors"
        style={{ background: isActive ? "var(--bg-active)" : undefined }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = "transparent";
        }}
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
    );
  };

  const renderTreeNodes = (node: TreeNode, depth: number): ReactNode[] => {
    const items: ReactNode[] = [];
    const indent = indentFor(depth);
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
          style={{ paddingLeft: `${indent}px` }}
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
            className={`text-[12px] font-mono${compact ? " truncate" : ""}`}
            style={{ color: "var(--text-secondary)" }}
          >
            {dir.name}
          </span>
          <span
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {fc}
          </span>
        </button>,
      );
      if (!isCollapsed) items.push(...renderTreeNodes(dir, depth + 1));
    }

    for (const child of nodeFiles) {
      const f = child.file!;
      const isActive = activeFile === f.path;
      items.push(
        <button
          key={f.path}
          onClick={() => onFileClick(f.path)}
          className="flex items-center gap-2 w-full px-2 py-1 rounded text-left transition-colors"
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

  return (
    <div>
      {headerExtra}
      {!hideHeader && (
      <div className="flex items-center gap-2 mb-2">
        <div
          className="text-[11px] font-semibold uppercase tracking-widest flex-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          {headerLabel} ({files.length})
        </div>
        {onViewModeChange && (
          <>
            <button
              type="button"
              onClick={() => onViewModeChange("flat")}
              className="p-1 rounded"
              style={{
                color:
                  viewMode === "flat"
                    ? "var(--accent)"
                    : "var(--text-tertiary)",
                background:
                  viewMode === "flat" ? "var(--bg-hover)" : "transparent",
              }}
              title="Flat list"
            >
              <AlignJustify size={12} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("tree")}
              className="p-1 rounded"
              style={{
                color:
                  viewMode === "tree"
                    ? "var(--accent)"
                    : "var(--text-tertiary)",
                background:
                  viewMode === "tree" ? "var(--bg-hover)" : "transparent",
              }}
              title="Tree"
            >
              <FolderTree size={12} />
            </button>
          </>
        )}
      </div>
      )}
      <div className="space-y-0.5">
        {viewMode === "tree"
          ? renderTreeNodes(fileTree, 0)
          : files.map(renderFlatRow)}
      </div>
    </div>
  );
}

export default FileChangeList;
