import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
} from "lucide-react";
import useFileListSidebar from "./useFileListSidebar";

export interface FileListSource {
  id: string;
  label: string;
  count: number;
  rows: ReactNode;
  /**
   * Wraps the default group header. Callers that need a drop target return a
   * component here — a component boundary, so their hook runs once per mounted
   * source rather than inside the parent's map().
   */
  renderHeader?: (defaultHeader: ReactNode) => ReactNode;
  /** Suffix after the label, e.g. "(.kilo)". */
  hint?: string;
}

interface Props {
  /** Tab prefix for testids: "plans-tab" | "context-tab" | "section-files". */
  testId: string;
  title: string;
  icon?: ReactNode;
  sources: FileListSource[];
  detail: ReactNode;
  onRefresh?: () => void;
  /** Rendered above the source list, e.g. the QA review-rules block. */
  aboveList?: ReactNode;
  /** Filter/sort bar rendered above the source list (expanded view only). */
  controls?: ReactNode;
}

function SourceGroup({
  testId,
  source,
}: {
  testId: string;
  source: FileListSource;
}) {
  const [open, setOpen] = useState(true);
  const header = (
    <button
      data-testid={`${testId}-source-${source.id}`}
      onClick={() => setOpen((v) => !v)}
      className="flex items-center gap-1 w-full px-1 py-1 rounded-md text-xs font-medium transition-colors duration-100"
      style={{ color: "var(--text-primary)" }}
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <span className="truncate">{source.label}</span>
      {source.hint && (
        <span className="font-normal" style={{ color: "var(--text-muted)" }}>
          &nbsp;{source.hint}
        </span>
      )}
      <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
        {source.count}
      </span>
    </button>
  );
  return (
    <div className="mb-0.5">
      {source.renderHeader ? source.renderHeader(header) : header}
      {open && (
        <div
          className="ml-3 pl-1"
          style={{ borderLeft: "1px solid var(--border-subtle)" }}
        >
          {source.rows}
        </div>
      )}
    </div>
  );
}

export default function FileListSidebar({
  testId,
  title,
  icon,
  sources,
  detail,
  onRefresh,
  aboveList,
  controls,
}: Props) {
  const { collapsed, toggle } = useFileListSidebar();
  const total = sources.reduce((sum, s) => sum + s.count, 0);

  const toggleButton = (
    <button
      data-testid="file-list-sidebar-toggle"
      onClick={toggle}
      aria-expanded={!collapsed}
      title={collapsed ? "Show file list" : "Hide file list"}
      className="p-1.5 rounded transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
    </button>
  );

  if (collapsed) {
    return (
      <div className="flex flex-row gap-2 md:gap-4">
        <aside className="shrink-0">{toggleButton}</aside>
        <section className="flex-1 min-w-0">{detail}</section>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <aside className="md:w-72 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            {icon}
            {title}
            <span
              data-testid={`${testId}-count`}
              className="text-[10px] font-normal"
              style={{ color: "var(--text-muted)" }}
            >
              {total}
            </span>
          </h2>
          <div className="flex items-center">
            {onRefresh && (
              <button
                data-testid={`${testId}-refresh`}
                onClick={onRefresh}
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
            )}
            {toggleButton}
          </div>
        </div>

        {controls}
        {aboveList}

        <div className="text-sm">
          {sources.length === 1 ? (
            sources[0].rows
          ) : (
            sources.map((s) => (
              <SourceGroup key={s.id} testId={testId} source={s} />
            ))
          )}
        </div>
      </aside>

      <section className="flex-1 min-w-0">{detail}</section>
    </div>
  );
}
