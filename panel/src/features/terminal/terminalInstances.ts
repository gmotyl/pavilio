import { Terminal } from "@xterm/xterm";
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
}

interface InternalInstance extends LiveTerminal {
  refCount: number;
  exitListeners: Set<ExitListener>;
  exited: boolean;
  exitCode: number | undefined;
}

const instances = new Map<string, InternalInstance>();

export function refitAll(): void {
  for (const inst of instances.values()) inst.fit();
}

/**
 * Custom xterm key event handler that makes Shift+Enter insert a literal
 * newline into the current line buffer (via `term.paste("\n")`) instead of
 * letting xterm forward `\r` to the pty. Plain Enter is untouched so TUIs
 * like Claude Code / OpenCode keep treating it as "submit".
 *
 * Exported as a pure helper so it can be unit-tested without a real
 * Terminal/jsdom wiring.
 */
export function shiftEnterHandler(term: { paste: (d: string) => void }) {
  return (e: { type: string; key: string; shiftKey: boolean }) => {
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      term.paste("\n");
      return false; // stop xterm from also sending \r
    }
    return true;
  };
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
  terminal.attachCustomKeyEventHandler(shiftEnterHandler(terminal));

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

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/terminal/${sessionId}`,
  );

  const sendResize = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows,
      }),
    );
  };

  ws.onopen = () => {
    try {
      fitAddon.fit();
    } catch (err) {
      console.warn(`[terminal:${sessionId}] fit on ws open failed:`, err);
    }
    sendResize();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") {
        terminal.write(msg.data);
      } else if (msg.type === "exit") {
        terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        const inst = instances.get(sessionId);
        if (inst) {
          inst.exited = true;
          inst.exitCode = typeof msg.code === "number" ? msg.code : undefined;
          for (const l of inst.exitListeners) l(inst.exitCode);
        }
      }
    } catch (err) {
      console.warn(`[terminal:${sessionId}] malformed ws payload:`, err, event.data);
    }
  };

  ws.onerror = (event) => {
    console.warn(`[terminal:${sessionId}] websocket error:`, event);
    terminal.write("\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n");
  };

  terminal.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  const inst: InternalInstance = {
    sessionId,
    terminal,
    fitAddon,
    holder,
    ws,
    refCount: 0,
    exitListeners: new Set(),
    exited: false,
    exitCode: undefined,
    send: (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    },
    fit: () => {
      try {
        fitAddon.fit();
      } catch (err) {
        console.warn(`[terminal:${sessionId}] fit failed:`, err);
      }
      sendResize();
    },
    focus: () => terminal.focus(),
    addExitListener: (fn: ExitListener) => {
      const i = instances.get(sessionId);
      if (!i) return () => undefined;
      i.exitListeners.add(fn);
      if (i.exited) fn(i.exitCode);
      return () => {
        i.exitListeners.delete(fn);
      };
    },
  };
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
