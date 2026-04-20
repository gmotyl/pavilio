export const BUSY_THRESHOLD_MS = 10_000;
export const IDLE_DEBOUNCE_MS = 1_000;

export type ActivityState = "idle" | "busy" | "attention";

export interface ActivityEvent {
  sessionId: string;
  state: ActivityState;
  at: number;
  attentionSinceAt?: number;
}

interface ActivityRecord {
  state: ActivityState;
  busyStartedAt: number | null;
  attentionSinceAt: number | null;
  idleTimer: NodeJS.Timeout | null;
}

const records = new Map<string, ActivityRecord>();
const listeners = new Set<(ev: ActivityEvent) => void>();

function notify(sessionId: string, rec: ActivityRecord): void {
  const ev: ActivityEvent = {
    sessionId,
    state: rec.state,
    at: Date.now(),
    ...(rec.state === "attention" && rec.attentionSinceAt != null
      ? { attentionSinceAt: rec.attentionSinceAt }
      : {}),
  };
  for (const fn of listeners) fn(ev);
}

function getOrCreate(sessionId: string): ActivityRecord {
  let r = records.get(sessionId);
  if (!r) {
    r = { state: "idle", busyStartedAt: null, attentionSinceAt: null, idleTimer: null };
    records.set(sessionId, r);
  }
  return r;
}

function clearIdleTimer(rec: ActivityRecord): void {
  if (rec.idleTimer) {
    clearTimeout(rec.idleTimer);
    rec.idleTimer = null;
  }
}

function scheduleIdleCheck(sessionId: string, rec: ActivityRecord): void {
  clearIdleTimer(rec);
  rec.idleTimer = setTimeout(() => {
    rec.idleTimer = null;
    const dur = rec.busyStartedAt != null ? Date.now() - rec.busyStartedAt : 0;
    // Do NOT clear busyStartedAt here — it persists so that a subsequent
    // recordOutput call can accumulate duration across brief idle gaps.
    if (dur > BUSY_THRESHOLD_MS) {
      rec.state = "attention";
      rec.attentionSinceAt = Date.now();
      rec.busyStartedAt = null; // done — clear after entering attention
    } else {
      rec.state = "idle";
      rec.attentionSinceAt = null;
      // keep busyStartedAt so next recordOutput accumulates duration
    }
    notify(sessionId, rec);
  }, IDLE_DEBOUNCE_MS);
}

export function recordOutput(sessionId: string): void {
  const rec = getOrCreate(sessionId);
  if (rec.state !== "busy") {
    rec.state = "busy";
    // Only reset busyStartedAt if we don't have one already — this allows
    // duration to accumulate across brief idle gaps between output bursts.
    if (rec.busyStartedAt == null) {
      rec.busyStartedAt = Date.now();
    }
    rec.attentionSinceAt = null;
    notify(sessionId, rec);
  }
  scheduleIdleCheck(sessionId, rec);
}

export function recordInput(sessionId: string): void {
  const rec = getOrCreate(sessionId);
  if (rec.state === "attention") {
    rec.state = "idle";
    rec.attentionSinceAt = null;
    rec.busyStartedAt = null;
    notify(sessionId, rec);
  }
}

export function dismiss(sessionId: string): void {
  const rec = getOrCreate(sessionId);
  if (rec.state === "attention") {
    rec.state = "idle";
    rec.attentionSinceAt = null;
    rec.busyStartedAt = null;
    notify(sessionId, rec);
  }
}

export function removeSession(sessionId: string): void {
  const rec = records.get(sessionId);
  if (rec) clearIdleTimer(rec);
  records.delete(sessionId);
}

export function getState(sessionId: string): ActivityState {
  return records.get(sessionId)?.state ?? "idle";
}

export function getAllStates(): Record<string, ActivityState> {
  const out: Record<string, ActivityState> = {};
  for (const [id, rec] of records) out[id] = rec.state;
  return out;
}

export function getSnapshot(): ActivityEvent[] {
  const now = Date.now();
  const out: ActivityEvent[] = [];
  for (const [id, rec] of records) {
    out.push({
      sessionId: id,
      state: rec.state,
      at: now,
      ...(rec.state === "attention" && rec.attentionSinceAt != null
        ? { attentionSinceAt: rec.attentionSinceAt }
        : {}),
    });
  }
  return out;
}

export function subscribe(fn: (ev: ActivityEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function _resetForTests(): void {
  for (const rec of records.values()) clearIdleTimer(rec);
  records.clear();
  listeners.clear();
}
