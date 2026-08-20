import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Star } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import {
  clearLastSectionFile,
  writeLastSectionFile,
} from "../shell/lastPath";
import {
  usePlansTree,
  fetchPlanFile,
  type PlanFile,
  type PlanSource,
} from "./usePlansTree";
import { usePlanDragSource, usePlanDropTarget } from "./usePlanDrag";
import { useFileListControls, filterAndSortFiles } from "./fileListControls";
import { useAutoSelectNewest } from "./useAutoSelectNewest";
import PathActions from "./PathActions";
import FileListSidebar, { type FileListSource } from "./FileListSidebar";
import FileRow from "./FileRow";

interface Props {
  projectName: string;
  currentPlans?: string[];
}

function PlanStar({
  file,
  currentEntry,
  onStar,
  onUnstar,
}: {
  file: PlanFile;
  currentEntry: string | undefined;
  onStar: (file: PlanFile) => void;
  onUnstar: (entry: string) => void;
}) {
  const isCurrent = currentEntry !== undefined;
  return (
    <button
      data-testid={`plans-tab-star-${file.filename}`}
      onClick={(e) => {
        e.stopPropagation();
        if (isCurrent && currentEntry) onUnstar(currentEntry);
        else onStar(file);
      }}
      title={isCurrent ? "Active plan — click to remove" : "Mark as active plan"}
      className={`shrink-0 p-1 rounded transition-all ${isCurrent ? "" : "opacity-0 group-hover:opacity-100"}`}
      style={{ color: isCurrent ? "var(--accent)" : "var(--text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Star size={12} fill={isCurrent ? "currentColor" : "none"} />
    </button>
  );
}

function PlanRows({
  source,
  projectName,
  selectedPath,
  currentByFilename,
  onOpen,
  onStar,
  onUnstar,
}: {
  source: PlanSource;
  projectName: string;
  selectedPath: string | null;
  currentByFilename: Map<string, string>;
  onOpen: (file: PlanFile) => void;
  onStar: (file: PlanFile) => void;
  onUnstar: (entry: string) => void;
}) {
  void projectName;
  if (source.files.length === 0) {
    return (
      <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
        (no plans)
      </p>
    );
  }
  return (
    <>
      {source.files.map((file) => {
        const currentEntry = currentByFilename.get(file.filename);
        return (
          <PlanRow
            key={file.absolutePath}
            file={file}
            sourceId={source.id}
            selected={selectedPath === file.absolutePath}
            currentEntry={currentEntry}
            starrable={source.id === "project"}
            onOpen={onOpen}
            onStar={onStar}
            onUnstar={onUnstar}
          />
        );
      })}
    </>
  );
}

function PlanRow({
  file,
  sourceId,
  selected,
  currentEntry,
  starrable,
  onOpen,
  onStar,
  onUnstar,
}: {
  file: PlanFile;
  sourceId: string;
  selected: boolean;
  currentEntry: string | undefined;
  starrable: boolean;
  onOpen: (file: PlanFile) => void;
  onStar: (file: PlanFile) => void;
  onUnstar: (entry: string) => void;
}) {
  const drag = usePlanDragSource(file.absolutePath);
  return (
    <FileRow
      testId={`plans-tab-file-${sourceId}-${file.filename}`}
      label={file.filename}
      selected={selected}
      isCurrent={currentEntry !== undefined}
      title={file.absolutePath}
      dragProps={drag}
      star={
        starrable ? (
          <PlanStar
            file={file}
            currentEntry={currentEntry}
            onStar={onStar}
            onUnstar={onUnstar}
          />
        ) : undefined
      }
      onSelect={() => onOpen(file)}
    />
  );
}

function PlanSourceHeader({
  projectName,
  sourceId,
  onMoved,
  header,
}: {
  projectName: string;
  sourceId: string;
  onMoved: () => void;
  header: ReactNode;
}) {
  const { hover, dropHandlers } = usePlanDropTarget(projectName, sourceId, onMoved);
  return (
    <div
      {...dropHandlers}
      style={{
        borderRadius: 6,
        background: hover ? "var(--accent-dim, var(--bg-active))" : undefined,
        outline: hover ? "1px solid var(--accent)" : undefined,
      }}
    >
      {header}
    </div>
  );
}

export default function PlansTab({ projectName, currentPlans }: Props) {
  const { data, loading, error, refresh } = usePlansTree(projectName);
  // Selection lives in the `?file=` URL param (like notes/memo) so the
  // plans tab link built by useProjectTabs can restore the open plan.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = searchParams.get("file");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const setSelectedPath = useCallback(
    (path: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (path) next.set("file", path);
          else next.delete("file");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const selectedFile = useMemo(() => {
    if (!data || !selectedPath) return null;
    for (const source of data.sources) {
      const file = source.files.find((f) => f.absolutePath === selectedPath);
      if (file) return file;
    }
    return null;
  }, [data, selectedPath]);

  // Load plan content when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setFileContent(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileContent(null);
    setFileError(null);
    fetchPlanFile(projectName, selectedPath)
      .then((r) => {
        if (!cancelled) setFileContent(r.content);
      })
      .catch((e) => {
        if (cancelled) return;
        setFileError(e instanceof Error ? e.message : String(e));
        clearLastSectionFile(projectName, "plans");
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, selectedPath]);

  // Persist last-open plan so the tab link can restore it
  useEffect(() => {
    if (!projectName) return;
    if (selectedPath) writeLastSectionFile(projectName, "plans", selectedPath);
    else clearLastSectionFile(projectName, "plans");
  }, [projectName, selectedPath]);

  // Map current-plan filename → its original CURRENT.md entry (used by the DELETE call).
  const currentByFilename = new Map<string, string>();
  for (const entry of currentPlans ?? []) {
    const filename = entry.split("/").pop() ?? entry;
    currentByFilename.set(filename, entry);
  }

  const onOpen = (file: PlanFile) => setSelectedPath(file.absolutePath);

  const onUnstar = async (entry: string) => {
    await fetch(
      `/api/projects/${projectName}/plans/current/${encodeURIComponent(entry)}`,
      { method: "DELETE" },
    );
    refresh();
  };

  const onStar = async (file: PlanFile) => {
    await fetch(
      `/api/projects/${projectName}/plans/current/${encodeURIComponent(file.filename)}`,
      { method: "POST" },
    );
    refresh();
  };

  const controls = useFileListControls();

  const sortOpts = {
    getName: (f: PlanFile) => f.filename,
    getMtime: (f: PlanFile) => f.modified,
    query: controls.debouncedQuery,
    sortKey: controls.sortKey,
    sortDir: controls.sortDir,
  };

  const projectFiles = data?.sources.find((s) => s.id === "project")?.files ?? [];
  const starred = projectFiles.filter((f) => currentByFilename.has(f.filename));
  const preferredKey = starred.length
    ? starred.reduce((a, b) => (b.modified > a.modified ? b : a)).absolutePath
    : null;

  const candidates = useMemo(
    () =>
      (data?.sources ?? [])
        // Archived plans are history — never auto-select-newest into one.
        .filter((s) => s.id !== "project:archived")
        .flatMap((s) => filterAndSortFiles(s.files, sortOpts))
        .map((f) => ({ key: f.absolutePath, mtime: f.modified })),
    [data, controls.debouncedQuery, controls.sortKey, controls.sortDir],
  );
  useAutoSelectNewest({
    candidates,
    selectedPath,
    onSelect: setSelectedPath,
    preferredKey,
  });

  if (loading && !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading plans…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--red)" }}>
        Failed to load plans: {error}
      </p>
    );
  }
  if (!data) return null;

  const sources: FileListSource[] = data.sources.map((s) => {
    const files = filterAndSortFiles(s.files, sortOpts);
    const isArchived = s.id === "project:archived";
    return {
      id: s.id,
      label: isArchived
        ? "Archived"
        : s.id === "project"
          ? "projects (current)"
          : s.label,
      count: files.length,
      hint:
        !isArchived && s.id !== "project" && s.id !== "claude"
          ? "(.kilo)"
          : undefined,
      // History: collapsed by default, and no drag-move header (archiving is
      // done by /pavilio-archive-plan, not by dragging in the panel).
      defaultOpen: isArchived ? false : undefined,
      renderHeader: isArchived
        ? undefined
        : (header) => (
            <PlanSourceHeader
              projectName={projectName}
              sourceId={s.id}
              onMoved={refresh}
              header={header}
            />
          ),
      rows: (
        <PlanRows
          source={{ ...s, files }}
          projectName={projectName}
          selectedPath={selectedPath}
          currentByFilename={s.id === "project" ? currentByFilename : new Map()}
          onOpen={onOpen}
          onStar={onStar}
          onUnstar={onUnstar}
        />
      ),
    };
  });

  return (
    <FileListSidebar
      testId="plans-tab"
      title="Plans"
      icon={<ClipboardList size={16} style={{ color: "var(--accent)" }} />}
      sources={sources}
      controls={controls.controlsBar}
      onRefresh={refresh}
      detail={
        <>
          {!selectedPath && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Select a plan to view.
            </p>
          )}
          {selectedPath && (
            <div
              className="flex items-center gap-2 mb-4 pb-3"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <span
                className="text-sm font-mono truncate flex-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                {selectedPath.split("/").pop()}
              </span>
              <PathActions absolutePath={selectedPath} />
            </div>
          )}
          {selectedPath && fileError && (
            <p className="text-sm" style={{ color: "var(--red)" }}>
              Failed to load file: {fileError}
            </p>
          )}
          {selectedPath && !fileError && fileContent === null && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </p>
          )}
          {fileContent !== null && (
            <MarkdownRenderer
              content={fileContent}
              basePath={selectedFile?.relativeToProjectsDir ?? undefined}
            />
          )}
        </>
      }
    />
  );
}
