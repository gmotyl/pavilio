import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionMeta } from "./useTerminalSessions";
import { sessionLabel } from "./useTerminalSessions";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { useAggregateActivityFlags } from "./useTerminalActivityChannel";
import { ProjectMark } from "../projects/ProjectMark";

interface Props {
  /** The minimised sessions, in session order. */
  sessions: SessionMeta[];
  /** Bring a session back into the grid. */
  onRestore: (id: string) => void;
  /**
   * The trigger's testid. The dot is `${testId}-led` and each menu row
   * `${testId}-item-${id}`.
   */
  testId: string;
  /** Which surface hosts the trigger: the desktop strip's folded tray or the mobile rail. */
  variant: "tray" | "rail";
}

const TRIGGER: Record<Props["variant"], { className: string; style: React.CSSProperties }> = {
  tray: {
    className:
      "shrink-0 mx-1.5 px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[11px] font-mono",
    style: {
      background: "var(--bg-elevated, var(--bg-active))",
      border: "1px solid var(--border-subtle)",
      color: "var(--text-primary)",
    },
  },
  rail: {
    className:
      "shrink-0 h-7 px-2 rounded-md flex items-center gap-1.5 text-[11px] font-mono active:scale-95 transition-transform",
    style: {
      background: "var(--bg-base)",
      border: "1px solid var(--border-subtle)",
      color: "var(--text-secondary)",
    },
  },
};

/**
 * "▁ N": every minimised session behind one trigger whose dot shows the loudest
 * state (attention > busy > idle), from the same flags `ProjectActivityLed`
 * reads. Its menu lists mark, LED and full label per session; choosing one
 * restores it. Shared by the folded desktop tray and the mobile rail.
 *
 * Both hosts clip what overflows them (the strip's slot, the rail's sideways
 * scroller), so the menu is portalled and pinned under the trigger. The pin is
 * measured once on open, so a window resize closes the menu rather than leave it
 * floating where the trigger used to be. Opening focuses the first row,
 * ArrowUp/ArrowDown move between rows (wrapping), Escape returns to the trigger.
 */
export function MinimisedCounter({ sessions, onRestore, testId, variant }: Props) {
  const ids = sessions.map((s) => s.id);
  const { hasAttention, hasBusy } = useAggregateActivityFlags(ids);
  const loudest = hasAttention ? "attention" : hasBusy ? "busy" : "idle";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const count = sessions.length;
  const name = `${count} minimised terminal${count === 1 ? "" : "s"}`;
  const trigger = TRIGGER[variant];

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  // Focus lands on the first row once the menu is pinned (and so visible — a
  // `visibility: hidden` element cannot take focus).
  useEffect(() => {
    if (!open || !pos) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, pos]);

  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      // From outside the menu, Down enters at the top and Up at the bottom.
      const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        className={trigger.className}
        style={trigger.style}
      >
        <span>▁ {count}</span>
        <span
          data-testid={`${testId}-led`}
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
            className="fixed z-50 min-w-[200px] max-w-[calc(100vw-16px)] p-1 rounded-md shadow-lg"
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
                data-testid={`${testId}-item-${s.id}`}
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

export default MinimisedCounter;
