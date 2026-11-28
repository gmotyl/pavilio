import { encodeReport, type ActivityLedSettings } from "./report";

export { ACTIVITY_LED_DEFAULTS, encodeReport, normaliseSettings } from "./report";
export type { ActivityLedSettings } from "./report";

export const HEARTBEAT_MS = 60_000;
// Matches the favicon's BUSY_FAVICON_DEBOUNCE_MS so the LED and tab agree.
export const BUSY_DEBOUNCE_MS = 2_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

export interface ActivityLedDeps {
  getSnapshot(): { sessionId: string; state: "idle" | "busy" | "attention" }[];
  subscribe(fn: (ev: { sessionId: string; state: string }) => void): () => void;
  getSettings(): ActivityLedSettings;
  machineId: string;
  send(buf: Buffer, host: string, port: number): Promise<void>;
  log(msg: string): void;
}

export interface ActivityLed {
  settingsChanged(): void;
  test(): void;
  stop(): void;
}

export function startActivityLed(deps: ActivityLedDeps): ActivityLed {
  const states = new Map<string, string>();
  const maturedBusy = new Set<string>();
  const busyTimers = new Map<string, NodeJS.Timeout>();
  const lastErrorLogAt = new Map<string, number>();
  let settings = deps.getSettings();
  let lastBuf: Buffer | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let stopped = false;

  const counts = () => {
    let attention = 0;
    for (const s of states.values()) if (s === "attention") attention++;
    return { attention, busy: maturedBusy.size };
  };

  const logError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    const last = lastErrorLogAt.get(msg);
    if (last !== undefined && now - last < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLogAt.set(msg, now);
    deps.log(`activity-led: send failed: ${msg}`);
  };

  const transmit = (buf: Buffer, s: ActivityLedSettings) => {
    try {
      deps.send(buf, s.host, s.port).catch(logError);
    } catch (err) {
      logError(err);
    }
  };

  const clearHeartbeat = () => {
    if (heartbeat) clearTimeout(heartbeat);
    heartbeat = null;
  };

  // Every send restarts the heartbeat so the board sees a report at least once a minute.
  const sendReport = (buf: Buffer) => {
    lastBuf = buf;
    transmit(buf, settings);
    clearHeartbeat();
    heartbeat = setTimeout(() => {
      if (stopped || !settings.enabled || !lastBuf) return;
      reconcile();
      update(true);
    }, HEARTBEAT_MS);
  };

  // Sends only when the encoded report differs, unless forced (start, settings change).
  const update = (force = false) => {
    if (stopped || !settings.enabled) return;
    const buf = encodeReport(settings, counts(), deps.machineId);
    if (!force && lastBuf?.equals(buf)) return;
    sendReport(buf);
  };

  const clearBusyTimer = (id: string) => {
    const t = busyTimers.get(id);
    if (t) clearTimeout(t);
    busyTimers.delete(id);
  };

  const apply = (sessionId: string, state: string) => {
    const prev = states.get(sessionId);
    states.set(sessionId, state);
    if (state === "busy") {
      // Busy counts only after continuous busy; a repeated busy event keeps the running timer.
      if (prev !== "busy") {
        busyTimers.set(
          sessionId,
          setTimeout(() => {
            busyTimers.delete(sessionId);
            // The session may have vanished without an event while the timer ran.
            reconcile();
            if (states.get(sessionId) !== "busy") return;
            maturedBusy.add(sessionId);
            update();
          }, BUSY_DEBOUNCE_MS),
        );
      }
    } else {
      clearBusyTimer(sessionId);
      maturedBusy.delete(sessionId);
    }
  };

  // Sessions can vanish without an event (pty exit), so prune ids missing from the snapshot.
  const reconcile = () => {
    const live = new Set(deps.getSnapshot().map((s) => s.sessionId));
    for (const id of [...states.keys()]) {
      if (live.has(id)) continue;
      states.delete(id);
      clearBusyTimer(id);
      maturedBusy.delete(id);
    }
  };

  for (const { sessionId, state } of deps.getSnapshot()) apply(sessionId, state);
  const unsubscribe = deps.subscribe((ev) => {
    reconcile();
    apply(ev.sessionId, ev.state);
    update();
  });
  update(true);

  return {
    settingsChanged() {
      if (stopped) return;
      const wasEnabled = settings.enabled;
      settings = deps.getSettings();
      if (wasEnabled && !settings.enabled) {
        // Blank the board at once instead of waiting for its 120 s expiry.
        clearHeartbeat();
        lastBuf = null;
        transmit(encodeReport(settings, { attention: 0, busy: 0 }, deps.machineId), settings);
        return;
      }
      update(true);
    },
    test() {
      if (stopped) return;
      const s = deps.getSettings();
      transmit(encodeReport(s, { attention: 1, busy: 1 }, deps.machineId), s);
    },
    stop() {
      stopped = true;
      unsubscribe();
      clearHeartbeat();
      for (const t of busyTimers.values()) clearTimeout(t);
      busyTimers.clear();
    },
  };
}
