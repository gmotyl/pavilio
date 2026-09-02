import { Terminal, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  imageFromClipboardItems,
  readClipboardImage,
  uploadPastedImage,
} from "./imagePaste";
import { viewportLooksBlank } from "./viewportBlank";
import { WATCHDOG_STALE_MS } from "./useMobileReconnect";

// Shared cache of live xterm instances, keyed by sessionId.
// The Terminal (+ its DOM node) survive React unmounts so that scrollback
// and visible buffer are preserved when a cell is hidden (tab switch,
// maximize toggle, sidebar collapse).

export const THEME = {
  background: "#1a1b26",
  foreground: "#a9b1d6",
  cursor: "#f0c674",
  selectionBackground: "#33467c",
  black: "#32344a",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#ad8ee6",
  cyan: "#449dab",
  white: "#787c99",
  brightBlack: "#444b6a",
  brightRed: "#ff7a93",
  brightGreen: "#b9f27c",
  brightYellow: "#ff9e64",
  brightBlue: "#7da6ff",
  brightMagenta: "#bb9af7",
  brightCyan: "#0db9d7",
  brightWhite: "#acb0d0",
};

type ExitListener = (code: number | undefined) => void;
type WsListener = (ws: WebSocket) => void;

/**
 * Liveness of this browser's socket for a session.
 *
 * "unattached" is reported for a session with no pooled instance in this
 * browser — no `TerminalView` has ever mounted it here, so there is no socket
 * to be alive or dead. That is a normal, frequent state (every session not
 * mounted in this tab) and must never read as a fault.
 */
export type ConnectionState = "connected" | "disconnected" | "unattached";

/**
 * What produced a reconnect-log record. Mirrors the server-side enum in
 * `server/lib/reconnect-log.ts`; the endpoint coerces anything else to
 * "manual", so an out-of-sync client cannot widen the column.
 *
 * - `manual` — the user clicked Reconnect (or the disconnected badge).
 * - `disconnect` — an attached session's socket died on its own.
 * - `auto-blank` — a blank-gated path reopened the session unasked.
 */
export type ReconnectTrigger = "manual" | "disconnect" | "auto-blank";

type ConnectionListener = (state: ConnectionState) => void;

export interface LiveTerminal {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  holder: HTMLDivElement;
  ws: WebSocket;
  send: (data: string) => void;
  fit: () => void;
  focus: () => void;
  addExitListener: (fn: ExitListener) => () => void;
  /**
   * Tear down the current ws and open a fresh one against the same session.
   * Used by the mobile-reconnect watchdog when the tab resumes and the
   * previous socket was silently killed by iOS Safari's background policy.
   */
  reopen: () => void;
  /**
   * Subscribe to ws swaps triggered by reopen(). Does NOT fire synchronously
   * with the current ws on subscription — callers must read `inst.ws` first
   * to prime their state. Returns an unsubscribe function.
   */
  onWsChange: (cb: (ws: WebSocket) => void) => () => void;
}

interface InternalInstance extends LiveTerminal {
  refCount: number;
  exitListeners: Set<ExitListener>;
  wsListeners: Set<WsListener>;
  exited: boolean;
  exitCode: number | undefined;
  // Subscriptions tied to the current ws — disposed before each reopen.
  dataDisposable: IDisposable | null;
  // Epoch ms of the last message received on the terminal ws (incl. pings).
  // Read by reconnectSession() to compute staleness metrics at click time.
  lastMessageAt: number;
  // Epoch ms of the last NON-ping frame (output/exit). Since the server pings
  // every 10s, lastMessageAt rarely goes stale; lastFrameAt distinguishes
  // "TUI idle but server alive" from "actually frozen" for gate tuning.
  lastFrameAt: number;
  // Liveness of `ws` as last reported by its own open/close/error events.
  // Only ever "connected" or "disconnected" — "unattached" is the absence of
  // an instance, so it has no representation here.
  connectionState: Exclude<ConnectionState, "unattached">;
}

const instances = new Map<string, InternalInstance>();

// Connection-state subscribers, keyed by sessionId and deliberately NOT held
// on the instance: a subscriber (the badge in the chrome) can outlive the
// pooled instance, and can subscribe to a session that has no instance yet.
// Entries are removed once their set empties, so nothing accumulates.
const connectionListeners = new Map<string, Set<ConnectionListener>>();

/**
 * Snapshot the terminal's state right now, in the exact field set the log has
 * used since #58. `blankAtClick` keeps its click-era name for the automatic
 * triggers too: renaming it would split the file into two incomparable eras,
 * which is the opposite of why the log exists.
 */
function buildReconnectMetric(
  inst: InternalInstance,
  trigger: ReconnectTrigger,
) {
  const now = Date.now();
  // pingMs includes keep-alive pings (matches the watchdog's own signal);
  // frameMs counts only real PTY frames, so it stays high while the TUI is
  // frozen even though pings keep pingMs fresh.
  const pingMs = now - inst.lastMessageAt;
  const frameMs = now - inst.lastFrameAt;
  return {
    sessionId: inst.sessionId,
    blankAtClick: viewportLooksBlank(inst.terminal),
    wsReadyState: inst.ws?.readyState,
    pingMs,
    frameMs,
    cols: inst.terminal.cols,
    rows: inst.terminal.rows,
    stale: pingMs > WATCHDOG_STALE_MS,
    trigger,
  };
}

/**
 * Append one line to the reconnect log. Strictly fire-and-forget: never
 * awaited, and every failure mode — a throwing metric read, a synchronous
 * fetch throw, a rejected promise — is swallowed here so that no caller's real
 * work (a reconnect, a socket close) can be blocked by diagnostics.
 */
function logReconnectMetric(
  inst: InternalInstance,
  trigger: ReconnectTrigger,
): void {
  try {
    void fetch("/api/terminal/reconnect-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildReconnectMetric(inst, trigger)),
    }).catch(() => {});
  } catch {
    // Logging must never block the caller.
  }
}

/**
 * Record a reopen that a blank-gated path performed on its own, identified by
 * the socket the caller holds — `useMobileReconnect` is handed a ws, not a
 * session id, and the pool is the only thing that can map one to the other.
 *
 * Call it BEFORE the reopen, so the metric describes the state that prompted
 * the reopen rather than the fresh socket. A ws belonging to no pooled
 * instance (or none at all) is a silent no-op.
 */
export function reportAutoBlankReopen(ws: WebSocket | null): void {
  if (!ws) return;
  for (const inst of instances.values()) {
    if (inst.ws === ws) {
      logReconnectMetric(inst, "auto-blank");
      return;
    }
  }
}

/**
 * Report a connection-state transition to every subscriber for the session.
 * A throwing subscriber must not starve the rest — same contract (and same
 * console.warn shape) as the `wsListeners` loop in connectWs.
 */
function emitConnectionState(sessionId: string, state: ConnectionState): void {
  const listeners = connectionListeners.get(sessionId);
  if (!listeners) return;
  // Snapshot: a subscriber is allowed to unsubscribe from inside its callback.
  for (const l of [...listeners]) {
    try {
      l(state);
    } catch (err) {
      console.warn(
        `[terminal:${sessionId}] connectionChange listener threw:`,
        err,
      );
    }
  }
}

function setConnectionState(
  inst: InternalInstance,
  state: Exclude<ConnectionState, "unattached">,
): void {
  // Log on the TRANSITION into disconnected, not on the events that cause it.
  // A browser can deliver `error` and then `close` for a single socket death,
  // and the transition is what dedupes them: one death, one row. It also bounds
  // volume structurally — a socket can only die once, so no path can loop.
  //
  // A cleanly exited process is excluded. `[Process exited]` is already on
  // screen and the server closes the socket right behind the exit frame
  // (watcher.ts enqueues both in one synchronous block), so those closes would
  // be the most common rows in the file while telling us nothing about the
  // question the log exists to answer: did a *live* terminal die, and was there
  // content on screen when it did?
  if (
    state === "disconnected" &&
    inst.connectionState !== "disconnected" &&
    !inst.exited
  ) {
    logReconnectMetric(inst, "disconnect");
  }
  inst.connectionState = state;
  emitConnectionState(inst.sessionId, state);
}

/**
 * Current liveness of this browser's socket for `sessionId`. Never throws for
 * an unknown session — see {@link ConnectionState}.
 */
export function getConnectionState(sessionId: string): ConnectionState {
  const inst = instances.get(sessionId);
  if (!inst) return "unattached";
  return inst.connectionState;
}

/**
 * True when the session's process has exited normally (an exit frame was
 * received). `false` for a session with no pooled instance in this browser.
 *
 * Deliberately separate from {@link ConnectionState}: an exit frame does not
 * touch connection state, so a cleanly exited shell reads "connected" until
 * the server closes the socket and then "disconnected" — indistinguishable
 * from a socket that died under a live process. Callers that mean "looks alive
 * but isn't" must exclude an exited session with this, since the terminal
 * already says `[Process exited]` on screen.
 */
export function hasExited(sessionId: string): boolean {
  return instances.get(sessionId)?.exited ?? false;
}

/**
 * Subscribe to connection-state changes for a session. Fires on the ws
 * open / close / error events, on reopen()'s identity swap, and when the
 * instance is destroyed ("unattached"). Does NOT fire synchronously on
 * subscription — prime with {@link getConnectionState} first.
 *
 * Safe (and expected) to call for a session with no instance. Returns an
 * unsubscribe function; calling it more than once is harmless.
 */
export function onConnectionChange(
  sessionId: string,
  cb: ConnectionListener,
): () => void {
  let listeners = connectionListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    connectionListeners.set(sessionId, listeners);
  }
  listeners.add(cb);
  return () => {
    const current = connectionListeners.get(sessionId);
    if (!current) return;
    current.delete(cb);
    if (current.size === 0) connectionListeners.delete(sessionId);
  };
}

// Optional WebSocket constructor override (for tests that don't run in a
// real browser). Falls back to the global constructor.
type WebSocketCtor = new (url: string) => WebSocket;
let wsCtorOverride: WebSocketCtor | null = null;
export function __setWebSocketCtorForTests(ctor: WebSocketCtor | null): void {
  wsCtorOverride = ctor;
}

function resolveWsCtor(): WebSocketCtor {
  if (wsCtorOverride) return wsCtorOverride;
  return WebSocket as unknown as WebSocketCtor;
}

export function refitAll(): void {
  for (const inst of instances.values()) inst.fit();
}

/** Minimal surface of an xterm Terminal needed to follow the bottom. */
interface FollowableTerminal {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom: () => void;
}

/**
 * Re-fit a terminal across a layout change (tab re-entry, reopen, visibility
 * regain) while preserving the user's scroll intent.
 *
 * The crucial part is the ORDER: we read "was the user at the bottom?" BEFORE
 * calling fit(). A resize that shrinks rows grows the scrollback, pushing
 * baseY ahead of the unchanged viewportY — so reading the flag after fit()
 * (the old bug) made an at-bottom terminal look scrolled-up and skipped the
 * scroll, leaving the cursor off-screen. Capture first, fit, then follow.
 */
export function followBottomAcrossResize(
  term: FollowableTerminal,
  fit: () => void,
): void {
  const { viewportY, baseY } = term.buffer.active;
  const wasAtBottom = viewportY >= baseY;
  fit();
  if (wasAtBottom) term.scrollToBottom();
}

/**
 * Re-fit every ACTIVE terminal, following the bottom for those at the bottom.
 * Parked terminals (refCount === 0) live in the hidden root at a fixed
 * 1200x800 — fitting them there would fire spurious PTY resizes and corrupt
 * their layout for when the user switches back, so they're skipped.
 */
export function refitAllAndFollow(): void {
  for (const inst of instances.values()) {
    if (inst.refCount > 0) followBottomAcrossResize(inst.terminal, inst.fit);
  }
}

/**
 * Custom xterm key event handler that makes Shift+Enter emit the
 * Claude-Code-documented multi-line convention: a literal backslash
 * followed by CR (`\\\r`). Claude Code treats `\<Enter>` as "continuation
 * — insert newline, keep accepting input." This is the one encoding
 * that actually prevents Claude Code from submitting.
 *
 * Prior attempts and why they failed:
 *   - `term.paste("\n")` — bracketed-paste wrapping; submitted.
 *   - Raw `\n` — LF treated as submit.
 *   - `\e\r` (iTerm Alt+Enter convention) — Claude parsed as
 *     Escape+Enter; newline rendered then submitted.
 *   - `\e[13;2u` (Kitty protocol Shift+Enter) — Claude ignored the CSI
 *     sequence; submitted.
 *
 * Trade-off: TUIs that don't have Claude's backslash-continuation
 * convention (bash, opencode if it differs) will see a literal `\`
 * followed by a submit. That's slightly ugly but not catastrophic —
 * the user gets `\` on their prompt line and whatever was submitted.
 * For the common pavilio use case (chatting with Claude Code), this
 * is the right default.
 *
 * Exported as a pure helper so it can be unit-tested without a real
 * Terminal/jsdom wiring.
 *
 * Also owns the Ctrl+C / Ctrl+Shift+C split (Windows convention: Ctrl+C
 * copies when text is selected, Ctrl+Shift+C always cancels):
 *   - Ctrl+C with a selection: return false to stop xterm sending its own
 *     `\x03` (xterm's default handler would send it regardless of
 *     selection), but deliberately skip preventDefault so the browser
 *     still issues its copy command. Net effect: copy only.
 *
 *     The copy itself is xterm's, not the DOM's: `Terminal._initGlobal`
 *     registers a `copy` listener on `terminal.element` whose handler is
 *     `clipboardData.setData("text/plain", selectionService.selectionText)`
 *     (@xterm/xterm 6.0.0). It reads xterm's own selection model, so it
 *     does not depend on the canvas selection being bridged into a DOM
 *     range, and behaves the same on every browser/OS. All this branch has
 *     to do is not swallow the keydown: `Terminal._keyDown` bails at
 *     `if (this._customKeyEventHandler(e) === false) return false` before
 *     `evaluateKeyboardEvent` can emit `\x03`, while the un-prevented
 *     default still fires the `copy` event. This is unchanged from the
 *     pre-PR behaviour — the bug was the extra `\x03` alongside the copy,
 *     never the copy itself.
 *   - Ctrl+C with no selection: nothing to copy, so fall back to sending
 *     the interrupt — a bare Ctrl+C still cancels a runaway process,
 *     matching native Windows Terminal/cmd.exe muscle memory.
 *   - Ctrl+Shift+C: always sends the interrupt, regardless of selection —
 *     an explicit, unambiguous cancel chord. This deliberately takes the
 *     chord away from xterm's stock copy binding; Ctrl+C above is the copy
 *     chord now, so no copy capability is lost. preventDefault/
 *     stopPropagation are required here (unlike the plain-Ctrl+C branch)
 *     because this key is no longer meant to reach anything else.
 */
export function shiftEnterHandler(
  sendToPty: (data: string) => void,
  hasSelection: () => boolean = () => false,
) {
  return (e: {
    type: string;
    key: string;
    shiftKey: boolean;
    ctrlKey?: boolean;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      sendToPty("\\\r");
      return false; // stop xterm from also sending \r
    }
    if (e.type === "keydown" && e.ctrlKey && e.key.toLowerCase() === "c") {
      if (e.shiftKey) {
        sendToPty("\x03");
        e.preventDefault?.();
        e.stopPropagation?.();
        return false;
      }
      if (hasSelection()) {
        // No preventDefault/stopPropagation: the un-prevented default is
        // what fires the `copy` event xterm listens for (see above).
        return false;
      }
      sendToPty("\x03");
      return false;
    }
    return true;
  };
}

// On mobile, the on-screen keyboard shrinks the visual viewport without
// always firing ResizeObserver on our flex container in time. Re-fit
// every live terminal when the visual viewport changes size so the
// cursor stays correctly sized inside the capped container (the
// `--vv-height` cap on TerminalsSurface keeps it above the keyboard).
if (typeof window !== "undefined" && window.visualViewport) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const onVVResize = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      refitAll();
    }, 80);
  };
  window.visualViewport.addEventListener("resize", onVVResize);
  window.visualViewport.addEventListener("scroll", onVVResize);
}

// When the browser tab regains visibility, the canvas was not painting while
// hidden and any output that streamed in left the rendered viewport stale —
// the user comes back to a terminal scrolled away from the cursor. Re-fit and
// follow the bottom (unless they had scrolled up) so the cursor is back in
// view. rAF defers until layout/canvas are live again after the tab shows.
// Guarded against the test env: vitest's resetModules re-imports this module
// per test, and the jsdom `document` persists across them — so an unguarded
// module-scope listener would accumulate one per test, leaking every prior
// module instance (and its terminals/sockets). Vite statically replaces
// process.env.NODE_ENV in the real build, so this is a no-op cost there.
if (typeof document !== "undefined" && process.env.NODE_ENV !== "test") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    requestAnimationFrame(() => refitAllAndFollow());
  });
}

// Expose a devtools handle so Claude hooks (or quick manual tests) can
// flip attention from outside React land without needing to import.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__panelTerminal = {
    refitAll,
  };
}

function getHiddenRoot(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(
    "panel-terminal-hidden-root",
  ) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "panel-terminal-hidden-root";
    el.setAttribute("aria-hidden", "true");
    el.style.position = "fixed";
    el.style.left = "-100000px";
    el.style.top = "0";
    el.style.width = "1200px";
    el.style.height = "800px";
    el.style.pointerEvents = "none";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Build a fresh WebSocket for the session and wire up all per-socket
 * subscriptions (output, exit, input, resize). The previous ws and its
 * onData disposable must already be torn down by the caller.
 *
 * Returns the new WebSocket. The instance's `ws` and `dataDisposable`
 * fields are updated in place.
 */
function connectWs(sessionId: string, inst: InternalInstance): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const Ctor = resolveWsCtor();
  const ws = new Ctor(
    `${protocol}//${window.location.host}/ws/terminal/${sessionId}`,
  );

  const sendResize = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "resize",
        cols: inst.terminal.cols,
        rows: inst.terminal.rows,
      }),
    );
  };

  // A handler must only speak for the socket it was registered on: a late
  // event from a superseded (reopen) or destroyed socket must not overwrite
  // state that belongs to its successor.
  const isCurrent = () => instances.get(sessionId) === inst && inst.ws === ws;

  ws.onopen = () => {
    // The SECOND of two intentional "connected" emits (the first is the
    // optimistic one at the `inst.ws` swap below). Do NOT dedupe the pair:
    // dropping the swap emit would strand first attach at "unattached" until
    // the handshake lands, and dropping this one would leave a failed-then-
    // retried handshake permanently optimistic.
    if (isCurrent()) setConnectionState(inst, "connected");
    try {
      inst.fitAddon.fit();
    } catch (err) {
      console.warn(`[terminal:${sessionId}] fit on ws open failed:`, err);
    }
    sendResize();
  };

  ws.onclose = () => {
    if (isCurrent()) setConnectionState(inst, "disconnected");
  };

  ws.onmessage = (event) => {
    // Stamp every inbound frame (output, exit, ping) so staleness metrics and
    // the reconnect watchdog share one notion of "last heard from the server".
    inst.lastMessageAt = Date.now();
    try {
      const msg = JSON.parse(event.data);
      // Everything except the keep-alive ping is a "real" frame from the PTY.
      if (msg.type !== "ping") inst.lastFrameAt = Date.now();
      if (msg.type === "output") {
        inst.terminal.write(msg.data);
      } else if (msg.type === "exit") {
        inst.terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        inst.exited = true;
        inst.exitCode = typeof msg.code === "number" ? msg.code : undefined;
        for (const l of inst.exitListeners) l(inst.exitCode);
      }
      // "ping" messages are intentionally ignored — their only purpose is
      // to keep the socket's lastMessageAt ref fresh for the mobile
      // reconnect watchdog in useMobileReconnect.
    } catch (err) {
      console.warn(
        `[terminal:${sessionId}] malformed ws payload:`,
        err,
        event.data,
      );
    }
  };

  ws.onerror = (event) => {
    console.warn(`[terminal:${sessionId}] websocket error:`, event);
    inst.terminal.write("\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n");
    // An error can arrive while readyState is still OPEN, and a browser does
    // not always follow it with a close we can observe — so the error itself
    // is the disconnect signal, not a hint to re-read readyState.
    if (isCurrent()) setConnectionState(inst, "disconnected");
  };

  // Re-register the terminal.onData → ws.send binding against the fresh
  // ws. The previous disposable (captured on inst.dataDisposable) is torn
  // down by the caller before we're invoked, so there's no double-send.
  inst.dataDisposable = inst.terminal.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  inst.ws = ws;

  // The identity swap itself is a connection-state event: an attach
  // (unattached → connected) or a reopen of a socket that had died. Reported
  // optimistically, before the socket has finished its handshake, so that a
  // terminal being connected right now does not wear a disconnected badge for
  // the duration of the handshake; a handshake that fails reports itself
  // through the error/close handlers above.
  //
  // The FIRST of two intentional "connected" emits — ws.onopen above fires the
  // second. The pair must not be deduped (see that comment), and this one only
  // reaches a snapshot-reading consumer because createInstance pools the
  // instance before calling connectWs.
  setConnectionState(inst, "connected");

  // Notify subscribers (TerminalView) that the ws identity changed so
  // they can feed the new reference into useMobileReconnect.
  for (const l of inst.wsListeners) {
    try {
      l(ws);
    } catch (err) {
      console.warn(`[terminal:${sessionId}] wsChange listener threw:`, err);
    }
  }

  return ws;
}

function createInstance(sessionId: string): InternalInstance {
  const holder = document.createElement("div");
  holder.style.width = "100%";
  holder.style.height = "100%";
  getHiddenRoot()?.appendChild(holder);

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    theme: THEME,
    scrollback: 5000,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(holder);
  try {
    fitAddon.fit();
  } catch (err) {
    console.warn(`[terminal:${sessionId}] initial fit failed:`, err);
  }

  // Two-finger vertical swipe. When the TUI has mouse tracking enabled
  // (opencode, Claude Code, vim mouse=a) we forward SGR wheel events to
  // the PTY so the TUI scrolls its own view. Otherwise (plain shell), we
  // scroll xterm's local scrollback. Single-finger touches still reach
  // xterm for selection / keyboard focus.
  //
  // `sendToPtyRef` is filled in after `inst` is constructed below; the
  // touchmove handler only fires at user interaction time, so referencing
  // it through the ref is safe.
  const sendToPtyRef: { current: ((data: string) => void) | null } = {
    current: null,
  };
  {
    let lastY: number | null = null;
    const avgY = (touches: TouchList) =>
      (touches[0].clientY + touches[1].clientY) / 2;
    holder.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) lastY = avgY(e.touches);
        else lastY = null;
      },
      { passive: true },
    );
    holder.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2 || lastY == null) return;
        const y = avgY(e.touches);
        const dy = y - lastY;
        const lineH = Math.max(1, holder.clientHeight / terminal.rows);
        const lines = Math.round(-dy / lineH);
        if (lines !== 0) {
          const mouseMode = (terminal as unknown as {
            modes?: { mouseTrackingMode?: string };
          }).modes?.mouseTrackingMode;
          const send = sendToPtyRef.current;
          if (mouseMode && mouseMode !== "none" && send) {
            // SGR mouse wheel: button 4 (up) = code 64, button 5 (down) = 65.
            // Press-only format: ESC [ < code ; col ; row M. Report at the
            // middle of the terminal so position-sensitive TUIs (tmux, etc.)
            // route scroll to the main pane rather than a corner.
            const code = lines < 0 ? 64 : 65;
            const col = Math.max(1, Math.floor(terminal.cols / 2));
            const row = Math.max(1, Math.floor(terminal.rows / 2));
            const steps = Math.abs(lines);
            for (let i = 0; i < steps; i++) {
              send(`\x1b[<${code};${col};${row}M`);
            }
          } else {
            terminal.scrollLines(lines);
          }
          lastY = y;
        }
        e.preventDefault();
      },
      { passive: false },
    );
    holder.addEventListener(
      "touchend",
      (e) => {
        if (e.touches.length < 2) lastY = null;
      },
      { passive: true },
    );
  }

  // Wheel is left entirely to xterm's built-in handler:
  //   • normal screen + no mouse-tracking → xterm scrolls its scrollback
  //   • mouse-tracking on (opencode, Claude Code, vim mouse=a) → xterm
  //     forwards the wheel to the PTY and the app handles it
  // An earlier capture-phase override that routed all wheels to xterm's
  // scrollback ("bypass TUI mouse-tracking") broke opencode / Claude chat
  // scroll because those apps bind wheel themselves. Trust xterm here.

  // Partially-initialised instance: `ws` and `dataDisposable` are filled
  // in by connectWs() below. We declare `inst` up-front so connectWs can
  // mutate it (and so the instance object identity is stable).
  const inst: InternalInstance = {
    sessionId,
    terminal,
    fitAddon,
    holder,
    // Temporary placeholder; replaced synchronously by connectWs().
    ws: null as unknown as WebSocket,
    refCount: 0,
    exitListeners: new Set(),
    wsListeners: new Set(),
    exited: false,
    exitCode: undefined,
    dataDisposable: null,
    lastMessageAt: Date.now(),
    lastFrameAt: Date.now(),
    // Temporary placeholder; replaced synchronously by connectWs() together
    // with `ws`, which it describes.
    connectionState: "disconnected",
    send: (data: string) => {
      const currentWs = inst.ws;
      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({ type: "input", data }));
      }
    },
    fit: () => {
      try {
        fitAddon.fit();
      } catch (err) {
        console.warn(`[terminal:${sessionId}] fit failed:`, err);
      }
      // Force a full redraw from the buffer. FitAddon is a no-op when
      // cols/rows didn't change (e.g., tab switch with unchanged outer
      // layout), and xterm won't repaint on its own — the canvas can
      // still hold stale/empty pixels from before the holder was detached,
      // producing the "terminal is blank until I toggle grid/full" symptom.
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
      } catch (err) {
        console.warn(`[terminal:${sessionId}] refresh failed:`, err);
      }
      const currentWs = inst.ws;
      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        currentWs.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    },
    focus: () => terminal.focus(),
    addExitListener: (fn: ExitListener) => {
      inst.exitListeners.add(fn);
      if (inst.exited) fn(inst.exitCode);
      return () => {
        inst.exitListeners.delete(fn);
      };
    },
    reopen: () => {
      // Tear down the current ws + its onData subscription, then open a
      // fresh one. `connectWs` re-registers onData against the new ws and
      // updates inst.ws / inst.dataDisposable in place.
      try {
        inst.dataDisposable?.dispose();
      } catch (err) {
        console.warn(`[terminal:${sessionId}] dispose onData during reopen:`, err);
      }
      inst.dataDisposable = null;
      const prev = inst.ws;
      if (prev) {
        try {
          // Detach handlers first so any late 'close' event from the old
          // socket doesn't clobber state tied to the new one.
          prev.onopen = null;
          prev.onmessage = null;
          prev.onerror = null;
          prev.onclose = null;
          prev.close();
        } catch (err) {
          console.warn(`[terminal:${sessionId}] ws.close during reopen:`, err);
        }
      }
      connectWs(sessionId, inst);
    },
    onWsChange: (fn: WsListener) => {
      inst.wsListeners.add(fn);
      return () => {
        inst.wsListeners.delete(fn);
      };
    },
  };

  terminal.attachCustomKeyEventHandler(
    shiftEnterHandler(inst.send, () => terminal.hasSelection()),
  );
  sendToPtyRef.current = inst.send;

  // Windows fix — Ctrl+V: intercept keydown in capture phase before xterm
  // sees it. preventDefault() suppresses the browser's paste event so there
  // is no double-paste. readText() is more reliable than clipboardData on
  // Windows Chrome. stopPropagation() keeps xterm's textarea from also
  // queuing a paste via onData.
  holder.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "v") {
        // Insecure context (plain http over LAN): clipboard API is absent —
        // bail WITHOUT preventDefault so the native paste event still fires
        // and the paste-event handler below can do the work.
        if (!navigator.clipboard?.readText) return;
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then(async (text) => {
          if (text) {
            terminal.paste(text);
            return;
          }
          // Empty text — the clipboard may hold an image (screenshot).
          const image = await readClipboardImage();
          if (!image) return;
          const path = await uploadPastedImage(image);
          if (path) terminal.paste(path + " ");
        }).catch(() => {});
      }
    },
    { capture: true },
  );

  // Windows fix — right-click context-menu paste: fires a paste event
  // directly (no preceding keydown). Intercept in capture phase to route
  // through terminal.paste(). Image pastes are uploaded to the server and
  // the saved path is pasted instead (the CLI can't see this browser's
  // clipboard when it runs on another machine).
  holder.addEventListener(
    "paste",
    (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) {
        terminal.paste(text);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const image = imageFromClipboardItems(e.clipboardData?.items);
      if (!image) return; // nothing usable — let xterm handle it
      e.preventDefault();
      e.stopPropagation();
      uploadPastedImage(image).then((path) => {
        if (path) terminal.paste(path + " ");
      });
    },
    { capture: true },
  );

  // Pool BEFORE connecting — the ordering is load-bearing, twice over:
  //   • connectWs's `isCurrent()` guard is `instances.get(sessionId) === inst`,
  //     and that must be true for the whole time connectWs runs, so the fresh
  //     socket's own handlers recognise themselves as current.
  //   • connectWs emits "connected" at the `inst.ws` swap. Emitting while the
  //     instance is not yet pooled means getConnectionState() still answers
  //     "unattached" at that instant, so a useSyncExternalStore consumer
  //     re-reads an unchanged snapshot and DROPS the emit rather than merely
  //     wasting it. `inst` is fully constructed here, so there is no reason to
  //     wait.
  instances.set(sessionId, inst);

  connectWs(sessionId, inst);

  return inst;
}

/**
 * Manually reopen a session's ws (the toolbar Reconnect button, and the
 * disconnected badge). Captures state-at-click metrics and POSTs them to the
 * reconnect log — best-effort, fire-and-forget — before tearing down and
 * rebuilding the socket.
 *
 * Deliberately logs before `reopen()`, which is also what keeps this from
 * double-counting: `reopen()` nulls the old socket's `onclose` before closing
 * it, so the close it causes is never observed and never adds a `disconnect`
 * row beside this `manual` one.
 */
export function reconnectSession(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  logReconnectMetric(inst, "manual");
  inst.reopen();
}

export function sendDismiss(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  const currentWs = inst.ws;
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify({ type: "dismiss-attention" }));
  }
}

export function acquireTerminal(sessionId: string): LiveTerminal {
  let inst = instances.get(sessionId);
  if (!inst) inst = createInstance(sessionId);
  inst.refCount++;
  return inst;
}

export function releaseTerminal(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  inst.refCount = Math.max(0, inst.refCount - 1);
  if (inst.refCount === 0) {
    // Detach from any visible container; park in the hidden root so the
    // terminal keeps its layout/buffer alive.
    getHiddenRoot()?.appendChild(inst.holder);
  }
}

export function destroyTerminal(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  try {
    inst.dataDisposable?.dispose();
  } catch (err) {
    console.warn(`[terminal:${sessionId}] dispose onData during destroy:`, err);
  }
  // Drop the instance from the pool BEFORE closing, so the socket's own
  // handlers see themselves as superseded and stay silent, and so a
  // getConnectionState() from inside a listener already reads "unattached".
  instances.delete(sessionId);
  try {
    // Detach handlers as reopen() does: a browser's close event lands on a
    // later tick, and nothing about a destroyed instance should still speak.
    inst.ws.onopen = null;
    inst.ws.onmessage = null;
    inst.ws.onerror = null;
    inst.ws.onclose = null;
    inst.ws.close();
  } catch (err) {
    console.warn(`[terminal:${sessionId}] ws.close during destroy:`, err);
  }
  try {
    inst.terminal.dispose();
  } catch (err) {
    console.warn(`[terminal:${sessionId}] terminal.dispose:`, err);
  }
  inst.holder.remove();
  // The session is no longer attached in this browser: no socket, no fault.
  // Subscribers keep their subscription (they outlive the instance) but must
  // stop showing a stale disconnected state for a terminal that is gone.
  emitConnectionState(sessionId, "unattached");
}
