// Tracks DEC Private Mode state per PTY session by scanning the outgoing
// byte stream for `CSI ? <params> h` (set) / `CSI ? <params> l` (reset)
// sequences. Lets a newly-connecting WebSocket client receive a preamble
// that restores the modes the TUI emitted at startup — notably alt screen,
// mouse tracking, and bracketed paste. Without this, a browser refresh
// reconnects to a live PTY that never re-emits those sequences, so the new
// xterm instance defaults to "no mouse tracking" and wheel scroll, mouse
// clicks, and redraws stop working inside opencode / Claude Code / vim.

export interface ModeState {
  /** Mode number → "h" (set) or "l" (reset); absent = never seen. */
  modes: Record<number, "h" | "l">;
  /** Trailing bytes of an escape sequence that spanned a chunk boundary. */
  pending: string;
}

export function createModeState(): ModeState {
  return { modes: {}, pending: "" };
}

// Modes we care about for client state restore. Setting/resetting any
// other DEC private mode is harmless to ignore — those don't affect
// scroll/click/redraw correctness after reconnect.
const TRACKED_MODES = new Set([
  25, // cursor visibility
  47, 1049, // alt screen (old / with save-cursor)
  1000, 1001, 1002, 1003, // mouse tracking (click / highlight / button-event / any-event)
  1004, // focus event reporting
  1005, 1006, 1015, 1016, // mouse encodings (UTF-8 / SGR / URXVT / SGR-Pixels)
  2004, // bracketed paste
]);

// ESC [ ? <digits and ;> h|l
// eslint-disable-next-line no-control-regex
const DEC_RE = /\x1b\[\?([\d;]+)([hl])/g;

export function scanModeState(chunk: string, state: ModeState): void {
  const combined = state.pending + chunk;
  let lastEnd = 0;
  DEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DEC_RE.exec(combined)) !== null) {
    const [, params, action] = match;
    for (const p of params.split(";")) {
      const n = Number(p);
      if (TRACKED_MODES.has(n)) state.modes[n] = action as "h" | "l";
    }
    lastEnd = match.index + match[0].length;
  }
  // Preserve any trailing partial ESC sequence for the next chunk. A
  // complete DEC private mode set/reset is at most ~12 bytes; keep the
  // last 16 as safety. Strip anything before the last ESC so we don't
  // re-scan fully-parsed bytes.
  const tail = combined.slice(Math.max(lastEnd, combined.length - 16));
  const escIdx = tail.lastIndexOf("\x1b");
  state.pending = escIdx >= 0 ? tail.slice(escIdx) : "";
}

export function modePreamble(state: ModeState): string {
  // Emit alt screen first so subsequent modes apply to the alt buffer.
  const order = [
    1049, 47, 25, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004,
  ];
  let out = "";
  for (const n of order) {
    const v = state.modes[n];
    if (v !== undefined) out += `\x1b[?${n}${v}`;
  }
  return out;
}
