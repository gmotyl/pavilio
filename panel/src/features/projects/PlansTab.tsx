import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  ClipboardList,
  RefreshCw,
  Star,
} from "lucide-react";
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
import PathActions from "./PathActions";

interface Props {
  projectName: string;
  currentPlans?: string[];
}

function PlanFileRow({
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
  const isCurrent = currentEntry !== undefined;
  const drag = usePlanDragSource(file.absolutePath);
  return (
    <div className="group flex items-center gap-0.5">
      <button
        {...drag}
        data-testid={`plans-tab-file-${sourceId}-${file.filename}`}
        onClick={() => onOpen(file)}
        title={file.absolutePath}
        className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1 rounded-md text-left text-xs transition-colors"
        style={{
          background: selected ? "var(--bg-active)" : "transparent",
          color: selected
            ? "var(--text-primary)"
            : isCurrent
              ? "var(--accent)"
              : "var(--text-secondary)",
          fontWeight: isCurrent ? 600 : 400,
        }}
        onMouseEnter={(e) => {
          if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!selected) e.currentTarget.style.background = "transparent";
        }}
      >
        <FileText
          size={13}
          className="shrink-0"
          style={{ color: isCurrent ? "var(--accent)" : "var(--text-tertiary)" }}
        />
        <span className="truncate">{file.filename}</span>
      </button>
      {starrable && (
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
      )}
    </div>
  );
}

function PlanSourceNode({
  source,
  projectName,
  selectedPath,
  currentByFilename,
  onOpen,
  onStar,
  onUnstar,
  onMoved,
}: {
  source: PlanSource;
  projectName: string;
  selectedPath: string | null;
  currentByFilename: Map<string, string>;
  onOpen: (file: PlanFile) => void;
  onStar: (file: PlanFile) => void;
  onUnstar: (entry: string) => void;
  onMoved: () => void;
}) {
  const starrable = source.id === "project";
  const [open, setOpen] = useState(source.id === "project" || source.files.length > 0);
  const repoHint = source.id !== "project" && source.id !== "claude";
  const { hover, dropHandlers } = usePlanDropTarget(projectName, source.id, onMoved);
  return (
    <div className="mb-0.5">
      <button
        {...dropHandlers}
        data-testid={`plans-tab-source-${source.id}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-1 py-1 rounded-md text-xs font-medium transition-colors duration-100"
        style={{
          color: "var(--text-primary)",
          background: hover ? "var(--accent-dim, var(--bg-active))" : undefined,
          outline: hover ? "1px solid var(--accent)" : undefined,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hover ? "var(--accent-dim, var(--bg-active))" : "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = hover ? "var(--accent-dim, var(--bg-active))" : "transparent")}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">
          {source.id === "project" ? "projects (current)" : source.label}
        </span>
        {repoHint && (
          <span className="font-normal" style={{ color: "var(--text-muted)" }}>
            &nbsp;(.kilo)
          </span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
          {source.files.length}
        </span>
      </button>
      {open && (
        <div
          className="ml-3 pl-1"
          style={{ borderLeft: "1px solid var(--border-subtle)" }}
        >
          {source.files.length === 0 ? (
            <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
              (no plans)
            </p>
          ) : (
            source.files.map((file) => {
              const currentEntry = currentByFilename.get(file.filename);
              return (
                <PlanFileRow
                  key={file.absolutePath}
                  file={file}
                  sourceId={source.id}
                  selected={selectedPath === file.absolutePath}
                  currentEntry={currentEntry}
                  starrable={starrable}
                  onOpen={onOpen}
                  onStar={onStar}
                  onUnstar={onUnstar}
                />
              );
            })
          )}
        </div>
      )}
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

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <aside className="md:w-72 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ClipboardList size={16} style={{ color: "var(--accent)" }} />
            Plans
          </h2>
          <button
            data-testid="plans-tab-refresh"
            onClick={refresh}
            className="p-1.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="text-sm">
          {data.sources.map((s) => (
            <PlanSourceNode
              key={s.id}
              source={s}
              projectName={projectName}
              selectedPath={selectedPath}
              currentByFilename={s.id === "project" ? currentByFilename : new Map()}
              onOpen={onOpen}
              onStar={onStar}
              onUnstar={onUnstar}
              onMoved={refresh}
            />
          ))}
        </div>
      </aside>

      <section className="flex-1 min-w-0">
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
      </section>
    </div>
  );
}
