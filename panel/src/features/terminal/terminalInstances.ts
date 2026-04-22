import { Terminal, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// Shared cache of live xterm instances, keyed by sessionId.
// The Terminal (+ its DOM node) survive React unmounts so that scrollback
// and visible buffer are preserved when a cell is hidden (tab switch,
// maximize toggle, sidebar collapse).

const THEME = {
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
   * Subscribe to ws replacement. Fires synchronously from reopen() after
   * the new ws is wired up; used by TerminalView to push the fresh ws into
   * React state so useMobileReconnect can re-bind its watchdog listeners.
   */
  onWsChange: (fn: WsListener) => () => void;
}

interface InternalInstance extends LiveTerminal {
  refCount: number;
  exitListeners: Set<ExitListener>;
  wsListeners: Set<WsListener>;
  exited: boolean;
  exitCode: number | undefined;
  // Subscriptions tied to the current ws — disposed before each reopen.
  dataDisposable: IDisposable | null;
}

const instances = new Map<string, InternalInstance>();

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

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

/**
 * When the user taps a terminal on mobile, the software keyboard opens
 * and the visible viewport shrinks. Push the focused terminal all the
 * way down so its cursor sits just above the keyboard instead of being
 * hidden below the fold.
 */
function scrollFocusedTerminalIntoView(): void {
  if (!isMobileViewport()) return;
  const active = document.activeElement;
  if (!active) return;
  for (const inst of instances.values()) {
    if (inst.holder.contains(active)) {
      try {
        inst.holder.scrollIntoView({ block: "end", behavior: "smooth" });
      } catch {
        inst.holder.scrollIntoView(false);
      }
      return;
    }
  }
}

// On mobile, the on-screen keyboard shrinks the visual viewport without
// always firing ResizeObserver on our flex container in time. Re-fit
// every live terminal when the visual viewport changes size so the
// cursor stays above the keyboard.
if (typeof window !== "undefined" && window.visualViewport) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const onVVResize = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      refitAll();
      scrollFocusedTerminalIntoView();
    }, 80);
  };
  window.visualViewport.addEventListener("resize", onVVResize);
  window.visualViewport.addEventListener("scroll", onVVResize);
}

// Tapping a terminal fires focusin on its helper textarea. On mobile
// this is also the trigger for the OS keyboard — scroll the cell into
// view immediately (the vv resize handler above covers the follow-up
// once the keyboard finishes animating in).
if (typeof window !== "undefined") {
  window.addEventListener(
    "focusin",
    (e) => {
      if (!isMobileViewport()) return;
      const target = e.target as Node | null;
      if (!target) return;
      for (const inst of instances.values()) {
        if (inst.holder.contains(target)) {
          // Wait a frame so the keyboard starts animating and dvh updates.
          requestAnimationFrame(() => scrollFocusedTerminalIntoView());
          return;
        }
      }
    },
    true,
  );
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

  ws.onopen = () => {
    try {
      inst.fitAddon.fit();
    } catch (err) {
      console.warn(`[terminal:${sessionId}] fit on ws open failed:`, err);
    }
    sendResize();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
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

  // Two-finger vertical swipe = scroll xterm's scrollback (mirrors desktop
  // trackpad two-finger scroll, which xterm already handles as wheel).
  // Single-finger touches still reach xterm for selection / keyboard focus.
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
        // Approximate line height from terminal geometry.
        const lineH = Math.max(1, holder.clientHeight / terminal.rows);
        const lines = Math.round(-dy / lineH);
        if (lines !== 0) {
          terminal.scrollLines(lines);
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

  connectWs(sessionId, inst);

  instances.set(sessionId, inst);
  return inst;
}

export function sendDismiss(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (!inst) return;
  if (inst.ws.readyState === WebSocket.OPEN) {
    inst.ws.send(JSON.stringify({ type: "dismiss-attention" }));
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
  try {
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
  instances.delete(sessionId);
}
