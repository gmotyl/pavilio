import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
} from "lucide-react";
import useFileListSidebar from "./useFileListSidebar";

/**
 * Grace period before a hover-peek closes on mouse-leave. A re-enter (of the
 * overlay or the rail trigger strip) within this window cancels the close, so
 * crossing the seam between the strip and a short overlay never flickers.
 */
const PEEK_CLOSE_DELAY_MS = 120;

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
  const { collapsed, peeking, toggle, startPeek, endPeek } =
    useFileListSidebar();
  const total = sources.reduce((sum, s) => sum + s.count, 0);

  // Delayed close so a re-enter cancels it — kills the leave/enter flicker at
  // the seam between the rail trigger strip and a short overlay.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const openPeek = useCallback(() => {
    cancelClose();
    startPeek();
  }, [cancelClose, startPeek]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      endPeek();
    }, PEEK_CLOSE_DELAY_MS);
  }, [cancelClose, endPeek]);
  const closeNow = useCallback(() => {
    cancelClose();
    endPeek();
  }, [cancelClose, endPeek]);
  useEffect(() => cancelClose, [cancelClose]);

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

  // Shared expanded content — identical in the pinned-open (inline) view and the
  // hover-peek overlay, so the popup reads as the same list floating over detail.
  const listContent = (
    <>
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
    </>
  );

  // Rail mode = the sidebar is stored-collapsed (with or without an active peek).
  // The rail — toggle button + a hover trigger strip — stays IN FLOW in both
  // states, so opening a peek never reflows the detail pane. The peek overlay is
  // absolutely positioned, floating over the detail without shifting it.
  const railMode = collapsed || peeking;

  if (railMode) {
    // Bubble-phase (not capture): the file row's own onClick — selection /
    // navigation — runs first; only then do we collapse the peek. Capturing here
    // unmounted the row before its click could select anything.
    const onOverlayClick = (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest("[data-file-row]")) closeNow();
    };
    return (
      <div className="relative flex flex-row gap-2 md:gap-4">
        <aside
          data-testid="file-list-sidebar-rail"
          className="shrink-0 flex flex-col self-stretch"
        >
          {/* While peeking, the overlay carries the live toggle; the rail keeps
              an invisible same-size spacer so its width — and the detail's
              position — never changes. */}
          {peeking ? (
            <div aria-hidden className="p-1.5" style={{ visibility: "hidden" }}>
              <ChevronsRight size={14} />
            </div>
          ) : (
            toggleButton
          )}
          {/* Hover trigger — everything in the rail EXCEPT the toggle button, so
              the button stays a pure manual toggle and never opens the peek. */}
          <div
            data-testid="file-list-sidebar-peek-trigger"
            aria-hidden
            className="flex-1 min-h-[1.5rem]"
            onMouseEnter={openPeek}
          />
        </aside>
        <section className="flex-1 min-w-0">{detail}</section>
        {peeking && (
          <aside
            data-testid="file-list-sidebar-peek"
            // Floats over the detail, so width is free: size to content (full
            // filenames) between a readable minimum and a viewport-bounded cap.
            className="absolute top-0 left-0 z-30 min-w-[18rem] w-max max-w-[min(42rem,90vw)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md p-3 shadow-lg"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onClick={onOverlayClick}
          >
            {listContent}
          </aside>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <aside className="md:w-72 shrink-0">{listContent}</aside>
      <section className="flex-1 min-w-0">{detail}</section>
    </div>
  );
}
