import { useEffect, useRef, useState } from "react";

interface WSMessage {
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
const RECONNECT_MESSAGE: WSMessage = {
  type: "file-change",
  event: "reconnect",
  path: "",
};

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  useEffect(() => {
    let disposed = false;
    let connections = 0;
    let lastMessageAt = Date.now();

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}`);
      wsRef.current = ws;
      lastMessageAt = Date.now();
      connections += 1;
      // Not on the first connect — nothing has been missed yet.
      if (connections > 1) setLastMessage({ ...RECONNECT_MESSAGE });

      ws.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setTimeout(connect, RECONNECT_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    // Closing a stale socket is enough — `onclose` owns the reconnect.
    const dropIfStale = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > STALE_MS) ws.close();
    };

    const onVisible = () => {
      // Background tabs have their timers throttled, so the interval below may
      // not have run during the gap that killed the socket.
      if (document.visibilityState === "visible") dropIfStale();
    };

    connect();
    const watchdog = setInterval(dropIfStale, WATCHDOG_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, []);

  return { lastMessage };
}
