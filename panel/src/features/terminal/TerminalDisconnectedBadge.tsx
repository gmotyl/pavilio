import { AlertTriangle } from "lucide-react";
import { hasExited, reconnectSession } from "./terminalInstances";
import { useTerminalConnection } from "./useTerminalConnection";

/** Accessible name and tooltip — names the state, then the recovery. */
export const DISCONNECTED_LABEL = "Disconnected — reconnect this terminal";

interface Props {
  sessionId: string;
  /** Icon scale. "sm" for dense chrome (chips, cell headers, drawer rows). */
  size?: "sm" | "lg";
}

/**
 * The (!) shown wherever a session is listed once this browser's socket for it
 * has died — and the control that repairs it. Self-contained: it reads its own
 * state and calls `reconnectSession` itself, so a host only places it.
 *
 * It means *this looks alive but is not*, which is narrower than "socket not
 * open" and excludes two cases deliberately:
 *
 * - `"unattached"` — this browser holds no terminal for the session. That is
 *   the normal state for every session not mounted in this tab; badging it
 *   would put a warning on most of the global terminals view.
 * - a process that exited normally — the socket does close, but the terminal
 *   already prints `[Process exited]`. Badging it would train the user to
 *   ignore the warning.
 *
 * An off-screen-but-pooled session is NOT excluded: `acquireTerminal` does not
 * reopen a dead socket, so viewing it again would present a stale frozen
 * screen with no explanation.
 *
 * `hasExited` is a plain read, not a subscription, so it is only re-evaluated
 * when connection state changes. That is sound because the exit frame always
 * lands first: the server sends `{type:"exit"}` and only then closes the
 * socket (`server/watcher.ts` `pty.onExit`), and the WebSocket API delivers
 * every queued `message` before the `close` event. So `inst.exited` is already
 * true by the time `"disconnected"` is emitted, and this never flashes for a
 * cleanly exited terminal.
 */
export function TerminalDisconnectedBadge({ sessionId, size = "sm" }: Props) {
  const state = useTerminalConnection(sessionId);

  if (state !== "disconnected") return null;
  if (hasExited(sessionId)) return null;

  return (
    <button
      type="button"
      data-testid={`terminal-disconnected-${sessionId}`}
      aria-label={DISCONNECTED_LABEL}
      title={DISCONNECTED_LABEL}
      // The hosts that carry this badge click through to focus, so the click
      // is swallowed the same way the close and eye controls beside it do.
      // Only the click: no host binds mousedown or pointerdown on an ancestor,
      // and their drag-to-reorder is HTML5 `draggable` + onDragStart, which the
      // browser starts independently of React's synthetic propagation.
      onClick={(e) => {
        e.stopPropagation();
        reconnectSession(sessionId);
      }}
      // p-1 matches the icon buttons it sits beside (the cell header's
      // CellIconButton row), so its presence does not shorten the row.
      //
      // "lg" is the mobile rail — the only touch-first host, where the visual
      // pill is 21px. The extra target is a transparent ::after inset outwards
      // rather than more padding: it lifts the tap area past the 24px minimum
      // without growing the badge's box, which rides on the corner of a 28px
      // pill inside a horizontally scrolling row.
      className={`shrink-0 flex items-center rounded transition-colors p-1 ${
        size === "lg"
          ? "relative after:absolute after:-inset-1 after:content-['']"
          : ""
      }`}
      style={{ color: "var(--yellow, #e0af68)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--orange, #ff9e64)";
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--yellow, #e0af68)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <AlertTriangle size={size === "lg" ? 13 : 11} />
    </button>
  );
}
