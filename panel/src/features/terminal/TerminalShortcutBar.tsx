import { useRef } from "react";

interface TerminalShortcutBarProps {
  onSend: (data: string) => void;
  onToggleKeyboard?: () => void;
}

interface ShortcutButton {
  key: string;
  label: string;
  data: string;
  mono?: boolean;
  important?: boolean;
  confirm?: boolean;
}

const BUTTONS: ShortcutButton[] = [
  { key: "esc", label: "Esc", data: "\x1b" },
  { key: "up", label: "↑", data: "\x1b[A", mono: true },
  { key: "down", label: "↓", data: "\x1b[B", mono: true },
  { key: "left", label: "←", data: "\x1b[D", mono: true },
  { key: "right", label: "→", data: "\x1b[C", mono: true },
  { key: "tab", label: "Tab", data: "\t", mono: true },
  { key: "shift-tab", label: "⇧Tab", data: "\x1b[Z", mono: true },
  { key: "ctrl-c", label: "Ctrl+C", data: "\x03", important: true },
  { key: "enter", label: "⏎", data: "\r", confirm: true },
];

/** Further than this between press and release is a swipe, not a tap. */
const TAP_SLOP_PX = 10;

/**
 * Fires `run` on a completed tap only. The row scrolls sideways, so a swipe
 * often starts on a button: acting on pointerdown sent that button's key at the
 * start of every swipe. A pan the browser takes over ends in pointercancel, and
 * one it does not ends in a pointerup too far from the press — neither fires.
 * Pointerdown still calls `preventDefault`, which keeps focus (and the
 * on-screen keyboard) on the terminal.
 */
function useTap() {
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  return (run: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || p.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP_PX) return;
      run();
    },
    onPointerCancel: () => {
      press.current = null;
    },
  });
}

export function TerminalShortcutBar({
  onSend,
  onToggleKeyboard,
}: TerminalShortcutBarProps) {
  const tap = useTap();
  return (
    // One line that scrolls sideways: wrapping grew the bar a line at a time on
    // a phone and took the height from the terminal above it.
    <div
      className="md:hidden flex flex-nowrap items-center gap-x-1 overflow-x-auto px-1.5 py-1 shrink-0"
      style={{
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      {BUTTONS.map((btn) => (
        <button
          key={btn.key}
          type="button"
          data-testid={`terminal-shortcut-${btn.key}`}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          {...tap(() => onSend(btn.data))}
          className={`shrink-0 rounded active:scale-95 transition-transform select-none${btn.mono ? " font-mono" : ""} ${
            btn.confirm
              ? "px-3.5 py-0.5 text-[14px] font-semibold"
              : "px-2 py-0.5 text-[12.5px]"
          }`}
          style={{
            background: btn.confirm
              ? "color-mix(in srgb, #9ece6a 28%, transparent)"
              : btn.important
                ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                : "var(--bg-base)",
            color: btn.confirm
              ? "#9ece6a"
              : btn.important
                ? "var(--accent)"
                : "var(--text-secondary)",
            border: `1px solid ${
              btn.confirm
                ? "color-mix(in srgb, #9ece6a 55%, transparent)"
                : btn.important
                  ? "color-mix(in srgb, var(--accent) 40%, transparent)"
                  : "var(--border-subtle)"
            }`,
          }}
        >
          {btn.label}
        </button>
      ))}
      {onToggleKeyboard && (
        <button
          type="button"
          data-testid="terminal-shortcut-toggle-keyboard"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          {...tap(onToggleKeyboard)}
          className="shrink-0 px-2 py-0.5 rounded text-[12.5px] active:scale-95 transition-transform select-none"
          style={{
            background: "var(--bg-base)",
            color: "var(--text-muted)",
            border: "1px solid var(--border-subtle)",
          }}
          title="Toggle keyboard"
        >
          ⌨
        </button>
      )}
    </div>
  );
}

export default TerminalShortcutBar;
