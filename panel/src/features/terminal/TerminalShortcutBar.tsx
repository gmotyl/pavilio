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

export function TerminalShortcutBar({
  onSend,
  onToggleKeyboard,
}: TerminalShortcutBarProps) {
  return (
    <div
      className="md:hidden flex flex-wrap items-center gap-x-1 gap-y-0.5 px-1.5 py-1 shrink-0"
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
          onPointerDown={(e) => {
            e.preventDefault();
            onSend(btn.data);
          }}
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
          onPointerDown={(e) => {
            e.preventDefault();
            onToggleKeyboard();
          }}
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
