import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionMeta } from "./useTerminalSessions";
import { sessionLabel } from "./useTerminalSessions";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { useAggregateActivityFlags } from "./useTerminalActivityChannel";
import { ProjectMark } from "../projects/ProjectMark";

interface Props {
  /** The surface's minimised sessions, in session order. May be empty. */
  sessions: SessionMeta[];
  /** Bring a session back into the grid. */
  onRestore: (id: string) => void;
}

/** A pill's cap: past it the label truncates and the tooltip carries it whole. */
const PILL_MAX_WIDTH = 150;

/**
 * The strip's flexible middle: the spacer that pushes the toolbar buttons right,
 * then the minimised tray — "▁ minimised" and one restore pill per session.
 *
 * The slot takes whatever width the chips leave (`flex: 1 1 0`). When the pills'
 * natural width does not fit in it, the tray folds into a "▁ N" counter whose
 * dropdown lists the same sessions. The natural width comes from an invisible,
 * absolutely positioned copy of the pills, so the measurement never depends on
 * whether the tray is folded — the fold cannot oscillate. An unmeasured slot
 * (jsdom, the first frame) counts as roomy: folding there would hide the pills
 * everywhere rather than only where they do not fit.
 */
export function MinimisedTray({ sessions, onRestore }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);
  const hasAny = sessions.length > 0;
  const contentKey = sessions.map((s) => `${s.id}:${sessionLabel(s)}`).join("|");

  const measure = useCallback(() => {
    const slot = slotRef.current;
    const pills = measureRef.current;
    if (!slot || !pills) {
      setFolded(false);
      return;
    }
    const available = slot.getBoundingClientRect().width;
    const needed = pills.getBoundingClientRect().width;
    setFolded(available > 0 && needed > available);
  }, []);

  useLayoutEffect(() => {
    measure();
    if (!hasAny) return;
    window.addEventListener("resize", measure);
    // The slot resizes without the window — a chip opening, closing or being
    // renamed — and a window listener hears none of that. Guarded because the
    // constructor is not in every environment the suite renders this in.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (slotRef.current) observer?.observe(slotRef.current);
    if (measureRef.current) observer?.observe(measureRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, hasAny, contentKey]);

  return (
    <div
      ref={slotRef}
      data-testid="minimised-tray-slot"
      className="relative flex items-center"
      // Unfolded, the slot may shrink below the pills (that is how a narrow strip
      // is noticed); folded, it keeps room for the counter so it is never clipped.
      style={{ flex: "1 1 0", minWidth: folded ? "auto" : 0, overflow: folded ? "visible" : "hidden" }}
    >
      <span data-testid="terminal-toolbar-spacer" className="flex-1 self-stretch" />
      {hasAny && (
        <>
          {folded ? (
            <MinimisedCounter sessions={sessions} onRestore={onRestore} />
          ) : (
            <div data-testid="minimised-tray" className="flex items-center gap-1 shrink-0 px-2" style={TRAY_STYLE}>
              <TrayLabel testId="minimised-tray-label" />
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`minimised-tray-pill-${s.id}`}
                  onClick={() => onRestore(s.id)}
                  title={`${sessionLabel(s)} — click to restore`}
                  aria-label={`Restore ${sessionLabel(s)}`}
                  className="flex items-center gap-1.5 shrink-0 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] font-mono transition-colors"
                  style={PILL_STYLE}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-base)")}
                >
                  <PillBody session={s} />
                </button>
              ))}
            </div>
          )}
          {/* The pills' natural width, laid out off-flow and never seen or read. */}
          <div
            ref={measureRef}
            data-testid="minimised-tray-measure"
            aria-hidden="true"
            className="flex items-center gap-1 px-2"
            style={{
              ...TRAY_STYLE,
              position: "absolute",
              top: 0,
              left: 0,
              width: "max-content",
              visibility: "hidden",
              pointerEvents: "none",
            }}
          >
            <TrayLabel />
            {sessions.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1.5 shrink-0 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] font-mono"
                style={PILL_STYLE}
              >
                <PillBody session={s} measuring />
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const TRAY_STYLE: React.CSSProperties = {
  borderLeft: "1px solid var(--border-subtle)",
  borderRight: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
};

const PILL_STYLE: React.CSSProperties = {
  maxWidth: `${PILL_MAX_WIDTH}px`,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-base)",
  color: "var(--text-secondary)",
};

function TrayLabel({ testId }: { testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="text-[11px] mr-0.5 whitespace-nowrap"
      style={{ color: "var(--text-tertiary)" }}
    >
      ▁ minimised
    </span>
  );
}

/** Mark tile in the project colour, the live LED, the label truncated. */
function PillBody({ session, measuring }: { session: SessionMeta; measuring?: boolean }) {
  return (
    <>
      <ProjectMark project={session.project} size={16} />
      {/* The measuring copy needs the LED's box, not a second subscriber. */}
      {measuring ? (
        <span className="terminal-led" />
      ) : (
        <TerminalActivityLed sessionId={session.id} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sessionLabel(session)}
      </span>
    </>
  );
}

/**
 * The folded tray: "▁ N" behind one trigger whose dot shows the loudest state
 * (attention > busy > idle), from the same flags `ProjectActivityLed` reads. Its
 * menu lists mark, LED and full label per session; choosing one restores it.
 */
function MinimisedCounter({
  sessions,
  onRestore,
}: {
  sessions: SessionMeta[];
  onRestore: (id: string) => void;
}) {
  const ids = sessions.map((s) => s.id);
  const { hasAttention, hasBusy } = useAggregateActivityFlags(ids);
  const loudest = hasAttention ? "attention" : hasBusy ? "busy" : "idle";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const count = sessions.length;
  const name = `${count} minimised terminal${count === 1 ? "" : "s"}`;

  // The slot clips what overflows it, so the menu is portalled and pinned under
  // the trigger instead of positioned inside the strip.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="minimised-tray-counter"
        onClick={() => setOpen((o) => !o)}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        className="shrink-0 mx-1.5 px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[11px] font-mono"
        style={{
          background: "var(--bg-elevated, var(--bg-active))",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <span>▁ {count}</span>
        <span
          data-testid="minimised-tray-counter-led"
          className="terminal-led"
          data-state={loudest}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Minimised terminals"
            className="fixed z-50 min-w-[230px] max-w-[calc(100vw-16px)] p-1 rounded-md shadow-lg"
            style={{
              top: pos?.top ?? 0,
              right: pos?.right ?? 8,
              visibility: pos ? "visible" : "hidden",
              background: "var(--bg-elevated, var(--bg-surface))",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                data-testid={`minimised-tray-item-${s.id}`}
                onClick={() => {
                  setOpen(false);
                  onRestore(s.id);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-[12px] font-mono"
                style={{ color: "var(--text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title={sessionLabel(s)}
              >
                <ProjectMark project={s.project} size={16} />
                <TerminalActivityLed sessionId={s.id} />
                <span>{sessionLabel(s)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export default MinimisedTray;
