import { useEffect, useState } from "react";

export type ActivityState = "idle" | "busy" | "attention";

interface ChannelRecord {
  state: ActivityState;
  attentionSinceAt: number | null;
  busySinceAt: number | null;
}

const records = new Map<string, ChannelRecord>();
const listeners = new Map<string, Set<(state: ActivityState) => void>>();

let ws: WebSocket | null = null;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

function notify(sessionId: string, state: ActivityState): void {
  const set = listeners.get(sessionId);
  if (set) for (const fn of set) fn(state);
}

interface IncomingEvent {
  sessionId: string;
  state: ActivityState;
  at: number;
  attentionSinceAt?: number;
}

function applyEvent(ev: IncomingEvent): void {
  const prev = records.get(ev.sessionId);
  const nextBusySinceAt =
    ev.state === "busy"
      ? prev?.state === "busy" && prev.busySinceAt != null
        ? prev.busySinceAt
        : ev.at
      : null;
  records.set(ev.sessionId, {
    state: ev.state,
    attentionSinceAt:
      ev.state === "attention" && typeof ev.attentionSinceAt === "number"
        ? ev.attentionSinceAt
        : null,
    busySinceAt: nextBusySinceAt,
  });
  notify(ev.sessionId, ev.state);
}

export function _applyEventForTests(ev: IncomingEvent): void {
  applyEvent(ev);
}

function connect(): void {
  if (typeof window === "undefined") return;
  try {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/terminal-activity`,
    );
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") applyEvent(msg as IncomingEvent);
      } catch (err) {
        console.warn("[terminal-activity] bad payload", err);
      }
    };
    ws.onclose = () => {
      ws = null;
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      wsRetryTimer = setTimeout(() => connect(), 2000);
    };
    ws.onerror = () => {
      /* onclose will fire next */
    };
  } catch {
    /* test env or no WS support */
  }
}

if (typeof window !== "undefined") connect();

export function getActivityState(sessionId: string): ActivityState {
  return records.get(sessionId)?.state ?? "idle";
}

export function getAttentionSinceAt(sessionId: string): number | null {
  return records.get(sessionId)?.attentionSinceAt ?? null;
}

export function getBusySinceAt(sessionId: string): number | null {
  return records.get(sessionId)?.busySinceAt ?? null;
}

export function subscribeActivity(
  sessionId: string,
  fn: (state: ActivityState) => void,
): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(sessionId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(sessionId);
  };
}

export function useActivityState(sessionId: string): ActivityState {
  const [state, setState] = useState<ActivityState>(() =>
    getActivityState(sessionId),
  );
  useEffect(() => {
    setState(getActivityState(sessionId));
    return subscribeActivity(sessionId, setState);
  }, [sessionId]);
  return state;
}

export function useAttentionSinceAt(sessionId: string): number | null {
  const state = useActivityState(sessionId);
  return state === "attention" ? getAttentionSinceAt(sessionId) : null;
}

export function _resetForTests(): void {
  records.clear();
  listeners.clear();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = null;
  }
}
