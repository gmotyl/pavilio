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
import { useWebSocket } from "../realtime/useWebSocket";
import { preferences } from "../../preferences/declarations";
import {
  usePreference,
  type PreferenceSetter,
} from "../../preferences/usePreference";
import { asPreferenceScope, type PreferenceDef } from "../../preferences/types";

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

/** Distinguishes the placeholder scopes below from one another. */
let unscopedInstances = 0;

/**
 * `usePreference` for a repo-scoped preference whose repo may not have
 * resolved.
 *
 * With no scope there is nothing to address, so the value lives in local state
 * seeded from the declared default: it renders and toggles, and nothing is read
 * or written. The bound hook is still called — hook order cannot depend on a
 * prop — under a placeholder scope unique to this component instance, so two
 * path-less repos can never meet on one key even if something later did write.
 */
function useOptionalScopePreference<T>(
  def: PreferenceDef<T>,
  scope: string | undefined,
): [T, PreferenceSetter<T>] {
  const placeholder = useRef("");
  if (placeholder.current === "") {
    // A NUL prefix: no filesystem path can collide with it.
    placeholder.current = `\u0000unscoped-${(unscopedInstances += 1)}`;
  }
  const bound = usePreference(def, scope ?? placeholder.current);
  const local = useState<T>(def.default);
  return scope === undefined ? local : bound;
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
  /**
   * The repo scope. `RepoBlock` renders this component for the tilde-spelled
   * path `repos.json` ships, and `GitWorktrees` renders another for the main
   * worktree's absolute path — ONE scope, so the two panes address one stored
   * value and must therefore SHARE it. Local state seeded once by
   * `readPreference` shared the key but not the value: closing one left the
   * other rendering open, and that other pane's next click re-asserted the
   * value instead of inverting it. `usePreference` subscribes, which fixes the
   * same-tab incoherence and the cross-tab one together — and it still reads in
   * the `useState` initializer, so nothing flashes a default, and it writes
   * only through its setter, so a mount still writes nothing.
   */
  const scope = asPreferenceScope(repo);
  const [storedBase, setStoredBase] = useOptionalScopePreference(
    preferences.branchDiffBase,
    scope,
  );
  /**
   * The main/master/develop fallback, deliberately NOT bound: that pick has
   * never been persisted, and binding it would PATCH one key per repository on
   * every page load. It only stands in while nothing is stored.
   */
  const [autoBase, setAutoBase] = useState("");
  const baseBranch = storedBase || autoBase;
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [commitsAhead, setCommitsAhead] = useState(0);
  const [loading, setLoading] = useState(false);
  const [storedOpen, setStoredOpen] = useOptionalScopePreference(
    preferences.branchDiffOpen,
    scope,
  );
  /**
   * `openFile` and the controlled `activeFile` force the section open, and that
   * has never been a stored choice either — so it overlays the stored value
   * rather than writing to it.
   */
  const [forcedOpen, setForcedOpen] = useState(false);
  const sectionOpen = forcedOpen || storedOpen;

  const [activeDiff, setActiveDiff] = useState<{ file: string } | null>(null);
  const [diffContent, setDiffContent] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffMode>("inline");
  // Monotonic id of the latest openDiff() call. Late responses for any
  // earlier id are dropped so a slow fetch can never overwrite the content
  // of a file the user has since clicked away from.
  const diffRequestIdRef = useRef(0);

  const { lastMessage } = useWebSocket();
  // Latest base branch, readable from ws handlers without re-subscribing.
  const baseBranchRef = useRef(baseBranch);
  baseBranchRef.current = baseBranch;

  const qs = `repo=${encodeURIComponent(repo)}`;

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`/api/git/branches?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setCurrentBranch(data.current);
      setBranches(data.branches.filter((b: string) => b !== data.current));
      // Auto-select a reasonable default, and only when nothing is chosen yet —
      // a stored pick is already `storedBase`, so there is nothing to re-read.
      if (!baseBranchRef.current) {
        const defaults = ["main", "master", "develop"];
        const found = defaults.find(
          (d) => data.branches.includes(d) && d !== data.current,
        );
        if (found) setAutoBase(found);
      }
    } catch {
      // Keep the current branch state; a later refresh retries.
    }
  }, [qs]);

  const fetchDiffFiles = useCallback(
    async (base: string) => {
      if (!base) {
        setFiles([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/git/branch-diff-files?base=${encodeURIComponent(base)}&${qs}`,
        );
        if (res.ok) {
          const data = await res.json();
          setFiles(data.files);
          setCommitsAhead(data.commitsAhead);
        } else {
          setFiles([]);
          setCommitsAhead(0);
        }
      } catch {
        setFiles([]);
        setCommitsAhead(0);
      } finally {
        setLoading(false);
      }
    },
    [qs],
  );

  // Fetch branches on mount / repo change
  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  // Fetch diff files when base branch changes
  useEffect(() => {
    setActiveDiff(null);
    fetchDiffFiles(baseBranch);
  }, [baseBranch, fetchDiffFiles]);

  // Refresh on git state changes elsewhere (checkout, commit, external edits).
  // Without this the diff keeps showing the previous HEAD until a page reload.
  useEffect(() => {
    if (
      lastMessage?.type !== "git-change" &&
      lastMessage?.type !== "file-change"
    )
      return;
    fetchBranches();
    fetchDiffFiles(baseBranchRef.current);
  }, [lastMessage, fetchBranches, fetchDiffFiles]);

  // Persist base branch selection — only the user's own pick, never the
  // auto-selected fallback, which lives in `autoBase` and is never written.
  const handleBaseBranchChange = (branch: string) => {
    setStoredBase(branch);
  };

  const handleSectionToggle = () => {
    // While something has forced the section open there is no stored `true` to
    // invert: what the user sees is the overlay, so the click drops it and
    // stores the closed state it produced.
    if (forcedOpen) {
      setForcedOpen(false);
      setStoredOpen(false);
      return;
    }
    // The updater form, not `!sectionOpen` out of the closure: two toggles in
    // one tick have to compose, and the setter resolves an updater against the
    // latest value rather than the rendered one.
    setStoredOpen((previous) => !previous);
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
      if (!sectionOpen) setForcedOpen(true);
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
      if (!sectionOpen) setForcedOpen(true);
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
          data-testid="git-branch-diff-toggle"
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
              testIdPrefix="git-branch-diff-base"
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
              testIdPrefix="git-branch-diff-files"
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
            data-testid="git-branch-diff-back"
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
              data-testid="git-branch-diff-mode-inline"
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
              data-testid="git-branch-diff-mode-side-by-side"
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
