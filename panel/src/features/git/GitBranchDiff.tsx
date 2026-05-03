import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Columns2,
  AlignJustify,
  GitCompareArrows,
} from "lucide-react";
import DiffView, { type DiffMode } from "./DiffView";
import BranchPicker from "./BranchPicker";
import FileChangeList from "./FileChangeList";

interface DiffFile {
  status: string;
  path: string;
}

interface GitBranchDiffProps {
  repo: string;
  viewMode?: "flat" | "tree";
  /** Callback when view mode changes (e.g. from sidebar toggle) */
  onViewModeChange?: (mode: "flat" | "tree") => void;
  fileFilter?: string;
  /** When set, auto-open the diff for this file path */
  openFile?: string | null;
  /** Text to highlight in the diff view */
  highlight?: string;
  /** Controlled active file inside the branch diff view */
  activeFile?: string | null;
  /** Notified when user opens or closes a file diff */
  onActiveFileChange?: (file: string | null) => void;
  /** When true, render the file list alongside the diff instead of replacing it. */
  showListSidebar?: boolean;
}

function lsKey(repo: string) {
  return `panel-branch-diff-base-${repo}`;
}

function openKey(repo: string) {
  return `panel-branch-diff-open-${repo}`;
}

export default function GitBranchDiff({
  repo,
  viewMode = "flat",
  onViewModeChange,
  fileFilter,
  openFile,
  highlight,
  activeFile,
  onActiveFileChange,
  showListSidebar = false,
}: GitBranchDiffProps) {
  const [currentBranch, setCurrentBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string>(() => {
    try {
      return localStorage.getItem(lsKey(repo)) || "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [commitsAhead, setCommitsAhead] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sectionOpen, setSectionOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(openKey(repo)) !== "false";
    } catch {
      return true;
    }
  });

  const [activeDiff, setActiveDiff] = useState<{ file: string } | null>(null);
  const [diffContent, setDiffContent] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffMode>("inline");
  // Monotonic id of the latest openDiff() call. Late responses for any
  // earlier id are dropped so a slow fetch can never overwrite the content
  // of a file the user has since clicked away from.
  const diffRequestIdRef = useRef(0);

  const qs = `repo=${encodeURIComponent(repo)}`;

  // Fetch branches
  useEffect(() => {
    fetch(`/api/git/branches?${qs}`).then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setCurrentBranch(data.current);
        setBranches(data.branches.filter((b: string) => b !== data.current));
        // Auto-select stored or first reasonable default
        if (!baseBranch) {
          const stored = localStorage.getItem(lsKey(repo));
          if (stored && data.branches.includes(stored)) {
            setBaseBranch(stored);
          } else {
            const defaults = ["main", "master", "develop"];
            const found = defaults.find(
              (d) => data.branches.includes(d) && d !== data.current,
            );
            if (found) setBaseBranch(found);
          }
        }
      }
    });
  }, [repo]);

  // Fetch diff files when base branch changes
  useEffect(() => {
    if (!baseBranch) {
      setFiles([]);
      return;
    }
    setLoading(true);
    setActiveDiff(null);
    fetch(
      `/api/git/branch-diff-files?base=${encodeURIComponent(baseBranch)}&${qs}`,
    )
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setFiles(data.files);
          setCommitsAhead(data.commitsAhead);
        } else {
          setFiles([]);
          setCommitsAhead(0);
        }
      })
      .catch(() => {
        setFiles([]);
        setCommitsAhead(0);
      })
      .finally(() => setLoading(false));
  }, [baseBranch, repo]);

  // Persist base branch selection
  const handleBaseBranchChange = (branch: string) => {
    setBaseBranch(branch);
    try {
      localStorage.setItem(lsKey(repo), branch);
    } catch {}
  };

  const handleSectionToggle = () => {
    const next = !sectionOpen;
    setSectionOpen(next);
    try {
      localStorage.setItem(openKey(repo), String(next));
    } catch {}
  };

  const openDiff = useCallback(
    async (file: string) => {
      const myId = ++diffRequestIdRef.current;
      setActiveDiff({ file });
      onActiveFileChange?.(file);
      setDiffContent("");
      setDiffLoading(true);
      let next = "";
      try {
        const res = await fetch(
          `/api/git/branch-diff?base=${encodeURIComponent(baseBranch)}&file=${encodeURIComponent(file)}&${qs}`,
        );
        if (res.ok) next = (await res.json()).diff ?? "";
      } catch {
        // keep next as ""
      }
      if (diffRequestIdRef.current !== myId) return;
      setDiffContent(next);
      setDiffLoading(false);
    },
    [baseBranch, qs, onActiveFileChange],
  );

  // External trigger to open a specific file diff
  useEffect(() => {
    if (openFile && baseBranch && files.some((f) => f.path === openFile)) {
      if (!sectionOpen) setSectionOpen(true);
      openDiff(openFile);
    }
  }, [openFile, baseBranch, files, sectionOpen, openDiff]);

  // Sync controlled activeFile prop into internal state
  useEffect(() => {
    if (activeFile === undefined) return;
    if (activeFile === null) {
      setActiveDiff(null);
    } else if (
      activeFile !== activeDiff?.file &&
      baseBranch &&
      files.some((f) => f.path === activeFile)
    ) {
      if (!sectionOpen) setSectionOpen(true);
      openDiff(activeFile);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, baseBranch, files, sectionOpen, openDiff]);

  const displayFiles = useMemo(
    () =>
      fileFilter
        ? files.filter((f) =>
            f.path.toLowerCase().includes(fileFilter.toLowerCase()),
          )
        : files,
    [files, fileFilter],
  );

  const renderSidebarList = () => (
    <FileChangeList
      files={displayFiles}
      activeFile={activeDiff?.file ?? null}
      onFileClick={openDiff}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      compact
    />
  );

  const renderList = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={handleSectionToggle}
          className="flex items-center gap-1.5 transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-secondary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--text-tertiary)")
          }
        >
          {sectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <GitCompareArrows size={12} style={{ color: "var(--accent)" }} />
          <span className="text-[11px] font-semibold uppercase tracking-widest">
            Branch Diff
          </span>
        </button>

        {sectionOpen && branches.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span
              className="text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              base:
            </span>
            <BranchPicker
              branches={branches}
              value={baseBranch}
              onChange={handleBaseBranchChange}
            />
            {commitsAhead > 0 && (
              <span
                className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                style={{
                  color: "var(--accent)",
                  background:
                    "color-mix(in srgb, var(--accent) 15%, transparent)",
                }}
              >
                +{commitsAhead} commits
              </span>
            )}
            {displayFiles.length > 0 && (
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {displayFiles.length}
                {fileFilter && displayFiles.length !== files.length
                  ? `/${files.length}`
                  : ""}{" "}
                files
              </span>
            )}
          </div>
        )}
      </div>

      {sectionOpen && (
        <>
          {!baseBranch && branches.length > 0 && (
            <p
              className="text-xs px-2 py-1"
              style={{ color: "var(--text-muted)" }}
            >
              Select a base branch to compare
            </p>
          )}
          {loading && (
            <p
              className="text-xs px-2 py-1 animate-pulse"
              style={{ color: "var(--text-muted)" }}
            >
              Loading diff...
            </p>
          )}
          {!loading &&
            baseBranch &&
            displayFiles.length === 0 &&
            !fileFilter && (
              <p
                className="text-xs px-2 py-1"
                style={{ color: "var(--text-muted)" }}
              >
                No differences from {baseBranch}
              </p>
            )}
          {!loading &&
            baseBranch &&
            displayFiles.length === 0 &&
            fileFilter && (
              <p
                className="text-xs px-2 py-1"
                style={{ color: "var(--text-muted)" }}
              >
                No matching files
              </p>
            )}
          {!loading && displayFiles.length > 0 && (
            <FileChangeList
              files={displayFiles}
              activeFile={activeDiff?.file ?? null}
              onFileClick={openDiff}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              hideHeader
            />
          )}
        </>
      )}
    </div>
  );

  const renderDiff = () =>
    activeDiff ? (
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => {
              setActiveDiff(null);
              onActiveFileChange?.(null);
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
            className="text-[11px] font-mono truncate flex-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            {activeDiff.file}
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            {baseBranch}...{currentBranch}
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
            highlight={highlight}
          />
        )}
      </div>
    ) : null;

  if (activeDiff) {
    if (showListSidebar) {
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
          <div className="flex-1 min-w-0">{renderDiff()}</div>
        </div>
      );
    }
    return renderDiff();
  }

  return renderList();
}
