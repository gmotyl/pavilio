import { useState } from "react";
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
  usePlansTree,
  fetchPlanFile,
  type PlanFile,
  type PlanSource,
} from "./usePlansTree";

interface Props {
  projectName: string;
  currentPlans?: string[];
}

function PlanSourceNode({
  source,
  selectedPath,
  currentByFilename,
  onOpen,
  onStar,
  onUnstar,
}: {
  source: PlanSource;
  selectedPath: string | null;
  currentByFilename: Map<string, string>;
  onOpen: (file: PlanFile) => void;
  onStar: (file: PlanFile) => void;
  onUnstar: (entry: string) => void;
}) {
  const starrable = source.id === "project";
  const [open, setOpen] = useState(source.id === "project" || source.files.length > 0);
  const repoHint = source.id !== "project" && source.id !== "claude";
  return (
    <div className="mb-0.5">
      <button
        data-testid={`plans-tab-source-${source.id}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-1 py-1 rounded-md text-xs font-medium transition-colors duration-100"
        style={{ color: "var(--text-primary)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
              const selected = selectedPath === file.absolutePath;
              const currentEntry = currentByFilename.get(file.filename);
              const isCurrent = currentEntry !== undefined;
              return (
                <div key={file.absolutePath} className="group flex items-center gap-0.5">
                  <button
                    data-testid={`plans-tab-file-${source.id}-${file.filename}`}
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
                        if (isCurrent) onUnstar(currentEntry);
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
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function PlansTab({ projectName, currentPlans }: Props) {
  const { data, loading, error, refresh } = usePlansTree(projectName);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedBasePath, setSelectedBasePath] = useState<string | undefined>(undefined);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Map current-plan filename → its original CURRENT.md entry (used by the DELETE call).
  const currentByFilename = new Map<string, string>();
  for (const entry of currentPlans ?? []) {
    const filename = entry.split("/").pop() ?? entry;
    currentByFilename.set(filename, entry);
  }

  const onOpen = async (file: PlanFile) => {
    setSelectedPath(file.absolutePath);
    setSelectedBasePath(file.relativeToProjectsDir ?? undefined);
    setFileContent(null);
    setFileError(null);
    try {
      const r = await fetchPlanFile(projectName, file.absolutePath);
      setFileContent(r.content);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

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
              selectedPath={selectedPath}
              currentByFilename={s.id === "project" ? currentByFilename : new Map()}
              onOpen={onOpen}
              onStar={onStar}
              onUnstar={onUnstar}
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
          <MarkdownRenderer content={fileContent} basePath={selectedBasePath} />
        )}
      </section>
    </div>
  );
}
