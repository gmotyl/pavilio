import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  ClipboardList,
  RefreshCw,
  X,
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
  onOpen,
}: {
  source: PlanSource;
  selectedPath: string | null;
  onOpen: (file: PlanFile) => void;
}) {
  const [open, setOpen] = useState(source.id === "project" || source.files.length > 0);
  const repoHint = source.id !== "project";
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
        {repoHint && source.id !== "claude" && (
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
              return (
                <button
                  key={file.absolutePath}
                  data-testid={`plans-tab-file-${source.id}-${file.filename}`}
                  onClick={() => onOpen(file)}
                  title={file.absolutePath}
                  className="flex items-center gap-2 w-full px-2 py-1 rounded-md text-left text-xs transition-colors"
                  style={{
                    background: selected ? "var(--bg-active)" : "transparent",
                    color: selected ? "var(--text-primary)" : "var(--text-secondary)",
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
                    style={{ color: "var(--text-tertiary)" }}
                  />
                  <span className="truncate">{file.filename}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ActivePlansBanner({
  projectName,
  plans,
  projectFiles,
  onOpen,
  onClosed,
}: {
  projectName: string;
  plans: string[];
  projectFiles: PlanFile[];
  onOpen: (file: PlanFile) => void;
  onClosed: () => void;
}) {
  return (
    <div
      className="mb-4 rounded-lg p-3"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--accent)",
        borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
      }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-widest mb-2"
        style={{ color: "var(--accent)" }}
      >
        Active Plans
      </h3>
      <div className="space-y-0.5">
        {plans.map((planFile) => {
          const fileName = planFile.split("/").pop() ?? planFile;
          const match = projectFiles.find((f) => f.filename === fileName);
          const label = fileName
            .replace(/\.md$/, "")
            .replace(/^\d{4}-\d{2}-\d{2}-/, "")
            .replace(/-/g, " ");
          return (
            <div key={planFile} className="flex items-center gap-1">
              <button
                data-testid={`plans-tab-active-open-${planFile}`}
                onClick={() => match && onOpen(match)}
                disabled={!match}
                className="flex items-center gap-3 flex-1 px-3 py-1.5 rounded-md text-left transition-colors disabled:opacity-50"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <FileText size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                <span
                  className="text-sm truncate flex-1 capitalize"
                  style={{ color: "var(--text-primary)" }}
                >
                  {label}
                </span>
              </button>
              <button
                data-testid={`plans-tab-active-close-${planFile}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  await fetch(
                    `/api/projects/${projectName}/plans/current/${encodeURIComponent(planFile)}`,
                    { method: "DELETE" },
                  );
                  onClosed();
                }}
                className="shrink-0 p-1 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--red)";
                  e.currentTarget.style.background = "var(--red-dim)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
                title="Close plan (remove from active)"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PlansTab({ projectName, currentPlans }: Props) {
  const { data, loading, error, refresh } = usePlansTree(projectName);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedBasePath, setSelectedBasePath] = useState<string | undefined>(undefined);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

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

  const projectFiles = data.sources.find((s) => s.id === "project")?.files ?? [];

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

        {currentPlans && currentPlans.length > 0 && (
          <ActivePlansBanner
            projectName={projectName}
            plans={currentPlans}
            projectFiles={projectFiles}
            onOpen={onOpen}
            onClosed={refresh}
          />
        )}

        <div className="text-sm">
          {data.sources.map((s) => (
            <PlanSourceNode
              key={s.id}
              source={s}
              selectedPath={selectedPath}
              onOpen={onOpen}
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
