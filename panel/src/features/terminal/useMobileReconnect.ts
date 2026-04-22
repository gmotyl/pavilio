import { useEffect, useRef } from "react";

interface Options {
  ws: WebSocket | null;
  getDims: () => { cols: number; rows: number };
  reopen: () => void;
}

const WATCHDOG_STALE_MS = 25_000;
const WATCHDOG_CHECK_MS = 2_000;

export function useMobileReconnect({ ws, getDims, reopen }: Options): void {
  const lastMessageAtRef = useRef(Date.now());

  useEffect(() => {
    if (!ws) return;
    const mark = () => {
      lastMessageAtRef.current = Date.now();
    };
    ws.addEventListener("message", mark);
    return () => ws.removeEventListener("message", mark);
  }, [ws]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reopen();
        return;
      }
      const { cols, rows } = getDims();
      ws.send(JSON.stringify({ type: "mobile-nudge", cols, rows }));
      lastMessageAtRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ws, getDims, reopen]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastMessageAtRef.current > WATCHDOG_STALE_MS) {
        lastMessageAtRef.current = Date.now(); // avoid repeated fires
        reopen();
      }
    }, WATCHDOG_CHECK_MS);
    return () => clearInterval(id);
  }, [reopen]);
}
