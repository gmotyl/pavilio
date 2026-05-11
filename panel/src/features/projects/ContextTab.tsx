import { useMemo, useState, type ReactElement } from "react";
import { BookOpen, FileText, RefreshCw } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import {
  useProjectContext,
  fetchContextFile,
  type AdrFile,
  type ContextFile,
  type ContextSource,
} from "./useProjectContext";

interface Props {
  projectName: string;
}

function SourceGroup<T extends { source: string }>({
  source,
  items,
  render,
  emptyLabel,
}: {
  source: ContextSource;
  items: T[];
  render: (item: T) => ReactElement;
  emptyLabel: string;
}) {
  return (
    <div className="mb-5">
      <h3
        className="text-[11px] font-semibold uppercase tracking-widest mb-2"
        style={{ color: "var(--text-tertiary)" }}
      >
        {source.label}
        {source.id !== "project" && (
          <span className="ml-2 font-normal lowercase opacity-60">
            (linked repo at <code>{source.absoluteRoot}</code>)
          </span>
        )}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs px-2" style={{ color: "var(--text-muted)" }}>
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-0.5">{items.map(render)}</div>
      )}
    </div>
  );
}

function FileRow({
  icon: Icon,
  label,
  testId,
  selected,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  testId: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors"
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
      <Icon size={13} style={{ color: "var(--text-tertiary)" }} />
      <span className="text-sm truncate">{label}</span>
    </button>
  );
}

export default function ContextTab({ projectName }: Props) {
  const { data, loading, error, refresh } = useProjectContext(projectName);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const onOpenFile = async (absolutePath: string) => {
    setSelectedPath(absolutePath);
    setFileContent(null);
    setFileError(null);
    try {
      const r = await fetchContextFile(projectName, absolutePath);
      setFileContent(r.content);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const grouped = useMemo(() => {
    if (!data) return null;
    const bySource = new Map<string, { contexts: ContextFile[]; adrs: AdrFile[] }>();
    for (const s of data.sources) bySource.set(s.id, { contexts: [], adrs: [] });
    for (const c of data.contexts) bySource.get(c.source)?.contexts.push(c);
    for (const a of data.adrs) bySource.get(a.source)?.adrs.push(a);
    return bySource;
  }, [data]);

  if (loading && !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading context…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--red)" }}>
        Failed to load context: {error}
      </p>
    );
  }
  if (!data || !grouped) return null;

  const anyContext = data.contexts.length > 0;
  const anyAdr = data.adrs.length > 0;

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <aside className="md:w-72 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BookOpen size={16} style={{ color: "var(--accent)" }} />
            Context
          </h2>
          <button
            data-testid="context-tab-refresh"
            onClick={refresh}
            className="p-1.5 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {!anyContext && !anyAdr ? (
          <div
            className="rounded-md p-4 text-sm"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            No context or decisions recorded yet. See <code>AGENTS.md</code> →
            <em> Domain Context & Decisions</em> for the convention.
          </div>
        ) : (
          <>
            {data.sources.map((s) => {
              const bucket = grouped.get(s.id);
              if (!bucket) return null;
              return (
                <SourceGroup
                  key={`ctx-${s.id}`}
                  source={s}
                  items={bucket.contexts}
                  emptyLabel="(no CONTEXT.md)"
                  render={(c) => (
                    <FileRow
                      key={c.absolutePath}
                      icon={BookOpen}
                      label={c.filename}
                      testId={`context-tab-file-${c.source}-${c.filename}`}
                      selected={selectedPath === c.absolutePath}
                      onClick={() => onOpenFile(c.absolutePath)}
                    />
                  )}
                />
              );
            })}

            <h2 className="text-base font-semibold mb-3 mt-6 flex items-center gap-2">
              <FileText size={16} style={{ color: "var(--accent)" }} />
              Decisions
            </h2>
            {data.sources.map((s) => {
              const bucket = grouped.get(s.id);
              if (!bucket) return null;
              return (
                <SourceGroup
                  key={`adr-${s.id}`}
                  source={s}
                  items={bucket.adrs}
                  emptyLabel="(no ADRs)"
                  render={(a) => (
                    <FileRow
                      key={a.absolutePath}
                      icon={FileText}
                      label={
                        a.adrNumber !== null
                          ? `${String(a.adrNumber).padStart(4, "0")} — ${a.slug.replace(/-/g, " ")}`
                          : a.filename
                      }
                      testId={`context-tab-adr-${a.source}-${a.filename}`}
                      selected={selectedPath === a.absolutePath}
                      onClick={() => onOpenFile(a.absolutePath)}
                    />
                  )}
                />
              );
            })}
          </>
        )}
      </aside>

      <section className="flex-1 min-w-0">
        {!selectedPath && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Select a file to view.
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
          <MarkdownRenderer
            content={fileContent}
            basePath={selectedPath ?? ""}
          />
        )}
      </section>
    </div>
  );
}
