import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import {
  ALERT_DURATION_MS,
  alerts,
  getAlertsSnapshot,
  subscribeAlerts,
  userDismissAlert,
  type AlertEntry,
  type AlertKind,
} from "./store";

/** Cards shown before the rest fold into the "+N more" pill. */
const VISIBLE_CAP = 3;

/** A release past this share of the card's width dismisses it. */
const SWIPE_DISTANCE = 0.35;
/** ...as does one faster than this, in px/ms over the whole drag. */
const SWIPE_VELOCITY = 0.6;
/** Matches the `[data-swipe="leaving"]` transition in index.css. */
const SLIDE_OUT_MS = 160;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

const palette: Record<AlertKind, { color: string; icon: LucideIcon }> = {
  error: { color: "var(--red)", icon: AlertCircle },
  warning: { color: "var(--yellow)", icon: AlertTriangle },
  info: { color: "var(--blue)", icon: Info },
  success: { color: "var(--green)", icon: CheckCircle2 },
};

/**
 * Transient entries newest first, then persistent entries newest first, so a
 * passing alert always lands above a standing warning and leaves without
 * moving it. "Newest" is store order: a refresh keeps its slot.
 */
function order(entries: readonly AlertEntry[]): AlertEntry[] {
  const newestFirst = entries.slice().reverse();
  return [...newestFirst.filter((e) => !e.persistent), ...newestFirst.filter((e) => e.persistent)];
}

/**
 * The panel-wide alert stack. Mounted outside `<Routes>`, so it survives
 * navigation; the store it reads lives outside React altogether.
 */
export default function AlertHost() {
  const entries = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot, getAlertsSnapshot);
  const [expanded, setExpanded] = useState(false);
  const [pausedIds, setPausedIds] = useState<ReadonlySet<string>>(() => new Set());
  const elapsedOf = useAlertClocks(entries, pausedIds);

  const setPaused = useCallback((id: string, paused: boolean) => {
    setPausedIds((prev) => {
      if (prev.has(id) === paused) return prev;
      const next = new Set(prev);
      if (paused) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const ordered = order(entries);
  // Collapse back once the overflow is gone, so the next overflow folds again.
  if (expanded && ordered.length <= VISIBLE_CAP) setExpanded(false);
  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_CAP);
  const hidden = ordered.length - visible.length;

  if (ordered.length === 0) return null;

  return (
    <div
      data-testid="alert-region"
      className="flex flex-col gap-2"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 24px))",
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      {visible.map((entry) => (
        <AlertCard
          key={entry.id}
          entry={entry}
          paused={pausedIds.has(entry.id)}
          onPausedChange={setPaused}
          elapsedOf={elapsedOf}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          data-testid="alert-more"
          onClick={() => setExpanded(true)}
          className="self-center rounded-full px-3 py-1 text-xs shadow"
          style={{
            pointerEvents: "auto",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}

interface AlertCardProps {
  entry: AlertEntry;
  paused: boolean;
  /** Hover and drag reports; the host owns the clock this pauses. */
  onPausedChange: (id: string, paused: boolean) => void;
  elapsedOf: (id: string, seq: number) => number;
}

interface Drag {
  pointerId: number;
  x: number;
  t: number;
  width: number;
}

function AlertCard({ entry, paused, onPausedChange, elapsedOf }: AlertCardProps) {
  const { id, seq } = entry;
  const { color, icon: Icon } = palette[entry.kind];
  const duration = ALERT_DURATION_MS[entry.kind];
  const bar = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const drag = useRef<Drag | null>(null);
  /** Set between a swipe past the threshold and the store removal. */
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hovering, dragging and sliding out each hold the countdown, so a card
  // cannot expire from under the pointer or mid-swipe.
  const reportPaused = () =>
    onPausedChange(id, hovered.current || drag.current !== null || leaving.current !== null);

  // Folding unmounts a hovered card without a pointerleave; release its pause.
  useEffect(() => () => onPausedChange(id, false), [id, onPausedChange]);

  // A card unmounted mid slide-out (folded by a new push) was still swiped away.
  useEffect(
    () => () => {
      if (leaving.current === null) return;
      clearTimeout(leaving.current);
      leaving.current = null;
      userDismissAlert(id);
    },
    [id],
  );

  // A card shown late (expanded from the fold) starts its bar where the clock is.
  useLayoutEffect(() => {
    if (bar.current) bar.current.style.animationDelay = `-${elapsedOf(id, seq)}ms`;
  }, [id, seq, elapsedOf]);

  // The drag writes the card's transform straight to the DOM: React owns no
  // `transform` in the style prop, so a re-render mid-drag leaves it alone.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (leaving.current !== null || drag.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // × keeps its click; a press on it never turns into a drag.
    if ((e.target as Element).closest("button")) return;
    const el = e.currentTarget;
    drag.current = { pointerId: e.pointerId, x: e.clientX, t: Date.now(), width: el.getBoundingClientRect().width };
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // No capture (synthetic pointer): the card still tracks moves over itself.
    }
    el.dataset.swipe = "dragging";
    reportPaused();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.currentTarget.style.transform = `translateX(${e.clientX - d.x}px)`;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    const dx = e.clientX - d.x;
    const dt = Math.max(1, Date.now() - d.t);
    const past = Math.abs(dx) > SWIPE_DISTANCE * d.width || Math.abs(dx) / dt > SWIPE_VELOCITY;
    if (cancelled || !past) {
      el.dataset.swipe = "settling";
      el.style.transform = "";
    } else if (prefersReducedMotion()) {
      userDismissAlert(id);
      return;
    } else {
      el.dataset.swipe = "leaving";
      el.style.transform = `translateX(${Math.sign(dx) * (d.width + 24)}px)`;
      el.style.opacity = "0";
      leaving.current = setTimeout(() => {
        leaving.current = null;
        userDismissAlert(id);
      }, SLIDE_OUT_MS);
    }
    reportPaused();
  };

  return (
    <div
      data-testid="alert"
      data-alert-id={id}
      data-kind={entry.kind}
      data-paused={paused ? "1" : "0"}
      role={entry.kind === "error" ? "alert" : "status"}
      onPointerEnter={() => {
        hovered.current = true;
        reportPaused();
      }}
      onPointerLeave={() => {
        hovered.current = false;
        reportPaused();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      className="alert-card relative flex items-start gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm shadow-lg"
      style={{
        pointerEvents: "auto",
        touchAction: "pan-y",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderLeft: `3px solid ${color}`,
        color: "var(--text-primary)",
      }}
    >
      <Icon size={16} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div className="min-w-0 flex-1">
        <div data-testid="alert-title" className="break-words">
          {entry.title}
        </div>
        {entry.detail && (
          <div className="mt-0.5 break-words text-xs" style={{ color: "var(--text-muted)" }}>
            {entry.detail}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid="alert-dismiss"
        onClick={() => userDismissAlert(entry.id)}
        aria-label="Dismiss"
        className="ml-2 rounded p-1 transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <X size={14} />
      </button>
      {!entry.persistent && (
        <div
          // A new seq is a refresh: remount the bar so its animation restarts.
          key={entry.seq}
          ref={bar}
          data-testid="alert-countdown"
          aria-hidden
          className="alert-countdown absolute bottom-0 left-0 h-[2px] w-full"
          style={{ background: color, animationDuration: `${duration}ms` }}
        />
      )}
    </div>
  );
}

interface Clock {
  seq: number;
  /** Full run for the entry's kind. */
  duration: number;
  /** Time left when the clock last stopped. */
  remaining: number;
  /** Set while running. */
  startedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function stop(clock: Clock): void {
  if (clock.timer === null || clock.startedAt === null) return;
  clearTimeout(clock.timer);
  clock.remaining -= Date.now() - clock.startedAt;
  clock.timer = null;
  clock.startedAt = null;
}

/**
 * One clock per live transient entry, owned by the host rather than the card,
 * so an entry folded behind "+N more" (whose card is unmounted) still counts
 * down and keeps its elapsed time when shown again. A clock runs unless its id
 * is in `pausedIds`; a new `seq` (a refresh of the same id) restarts it from
 * full. Expiry goes through `alerts.dismiss`, which by contract does not call
 * `onDismiss`.
 *
 * Returns how long an entry's current clock has run, for drawing its bar.
 */
function useAlertClocks(
  entries: readonly AlertEntry[],
  pausedIds: ReadonlySet<string>,
): (id: string, seq: number) => number {
  const clocks = useRef(new Map<string, Clock>());

  useEffect(() => {
    const map = clocks.current;
    const live = new Set<string>();
    for (const entry of entries) {
      if (entry.persistent) continue;
      const { id, seq } = entry;
      live.add(id);
      let clock = map.get(id);
      if (clock && clock.seq !== seq) {
        stop(clock);
        clock = undefined;
      }
      if (!clock) {
        const duration = ALERT_DURATION_MS[entry.kind];
        clock = { seq, duration, remaining: duration, startedAt: null, timer: null };
        map.set(id, clock);
      }
      if (pausedIds.has(id)) {
        stop(clock);
      } else if (clock.timer === null) {
        clock.startedAt = Date.now();
        clock.timer = setTimeout(() => alerts.dismiss(id), Math.max(0, clock.remaining));
      }
    }
    for (const [id, clock] of map) {
      if (live.has(id)) continue;
      stop(clock);
      map.delete(id);
    }
  }, [entries, pausedIds]);

  // Unmount stops (and banks) every clock; a remount resumes them.
  useEffect(() => {
    const map = clocks.current;
    return () => map.forEach(stop);
  }, []);

  return useCallback((id: string, seq: number) => {
    const clock = clocks.current.get(id);
    if (!clock || clock.seq !== seq) return 0;
    const running = clock.startedAt === null ? 0 : Date.now() - clock.startedAt;
    return Math.max(0, clock.duration - clock.remaining + running);
  }, []);
}
