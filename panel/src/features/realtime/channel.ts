export interface RealtimeFrame {
  type: string;
  [key: string]: unknown;
}

/**
 * A socket that went half-open (laptop sleep, network switch) never fires
 * `close` in the browser, so without a watchdog the tab keeps a dead connection
 * and stops refreshing until a manual reload. The server pings every 10s, so
 * three missed pings means the connection is gone.
 */
const STALE_MS = 35_000;
const WATCHDOG_CHECK_MS = 10_000;
const RECONNECT_MS = 2_000;

/**
 * Republished after a reconnect so every `file-change` consumer refetches what
 * it missed while the socket was down. `path: ""` on purpose: the viewers match
 * with `path.includes(theirFile)`, which stays false, so only the lists refresh.
 */
const RECONNECT_MESSAGE: RealtimeFrame = {
  type: "file-change",
  event: "reconnect",
  path: "",
};

type Listener = (frame: RealtimeFrame) => void;

const listeners = new Set<Listener>();

let socket: WebSocket | null = null;
let started = false;
let connections = 0;
let lastMessageAt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

function publish(frame: RealtimeFrame): void {
  // Copy first: a listener may unsubscribe while being notified.
  for (const listener of [...listeners]) listener(frame);
}

function connect(): void {
  if (!started) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}`);
  socket = ws;
  lastMessageAt = Date.now();
  connections += 1;
  // Not on the first connect — nothing has been missed yet.
  if (connections > 1) publish({ ...RECONNECT_MESSAGE });

  ws.onmessage = (event) => {
    lastMessageAt = Date.now();
    try {
      publish(JSON.parse(event.data));
    } catch {
      // ignore non-JSON messages
    }
  };

  ws.onclose = () => {
    // A socket we already replaced or tore down owns no reconnect.
    if (socket !== ws) return;
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Closing a stale socket is enough — `onclose` owns the reconnect.
function dropIfStale(): void {
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastMessageAt > STALE_MS) ws.close();
}

function onVisible(): void {
  // Background tabs have their timers throttled, so the interval below may
  // not have run during the gap that killed the socket.
  if (document.visibilityState === "visible") dropIfStale();
}

/**
 * The socket is tab-scoped, not subscriber-scoped: it opens once and stays open
 * for the life of the tab, so subscribers come and go without a reconnect storm.
 */
function start(): void {
  if (started) return;
  started = true;
  connect();
  watchdog = setInterval(dropIfStale, WATCHDOG_CHECK_MS);
  document.addEventListener("visibilitychange", onVisible);
}

/**
 * Start listening. Returns the unsubscribe. The first subscriber opens the
 * socket; later ones join it. A subscriber is delivered only frames that arrive
 * after this call — never a replayed earlier frame.
 */
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

/** Open subscriber count. For tests and diagnostics only. */
export function realtimeSubscriberCount(): number {
  return listeners.size;
}

/**
 * Test-only teardown: closes the socket, clears subscribers and timers. The
 * production path never closes the socket, so suites need this to avoid
 * leaking one between files.
 */
export function __resetRealtimeChannelForTests(): void {
  started = false;
  connections = 0;
  lastMessageAt = 0;
  listeners.clear();
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  document.removeEventListener("visibilitychange", onVisible);
  const ws = socket;
  socket = null; // before close, so `onclose` does not arm a reconnect
  ws?.close();
}
