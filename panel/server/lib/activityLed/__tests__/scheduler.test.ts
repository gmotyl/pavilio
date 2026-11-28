import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startActivityLed, type ActivityLedDeps } from "../index";
import { ACTIVITY_LED_DEFAULTS, type ActivityLedSettings } from "../report";

type State = "idle" | "busy" | "attention";

function makeDeps(opts: {
  settings?: Partial<ActivityLedSettings>;
  snapshot?: { sessionId: string; state: State }[];
  send?: ActivityLedDeps["send"];
} = {}) {
  let settings: ActivityLedSettings = { ...ACTIVITY_LED_DEFAULTS, enabled: true, ...opts.settings };
  const listeners = new Set<(ev: { sessionId: string; state: string }) => void>();
  const sent: { buf: Buffer; host: string; port: number }[] = [];
  const log = vi.fn<(msg: string) => void>();
  const deps: ActivityLedDeps = {
    getSnapshot: () => opts.snapshot ?? [],
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSettings: () => settings,
    machineId: "spock",
    send:
      opts.send ??
      ((buf, host, port) => {
        sent.push({ buf, host, port });
        return Promise.resolve();
      }),
    log,
  };
  return {
    deps,
    sent,
    log,
    listeners,
    emit: (sessionId: string, state: State) => listeners.forEach((fn) => fn({ sessionId, state })),
    setSettings: (s: Partial<ActivityLedSettings>) => {
      settings = { ...settings, ...s };
    },
  };
}

const counts = (buf: Buffer) => ({ attention: buf[21], busy: buf[22] });

describe("activity LED scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a report on start when enabled", () => {
    const h = makeDeps({ snapshot: [{ sessionId: "a", state: "attention" }] });
    const led = startActivityLed(h.deps);
    expect(h.sent).toHaveLength(1);
    expect(counts(h.sent[0].buf)).toEqual({ attention: 1, busy: 0 });
    expect(h.sent[0].host).toBe(ACTIVITY_LED_DEFAULTS.host);
    expect(h.sent[0].port).toBe(ACTIVITY_LED_DEFAULTS.port);
    led.stop();
  });

  it("counts busy only after 2 s of continuous busy", () => {
    const h = makeDeps();
    const led = startActivityLed(h.deps);
    expect(h.sent).toHaveLength(1);

    h.emit("a", "busy");
    vi.advanceTimersByTime(1999);
    expect(h.sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.sent).toHaveLength(2);
    expect(counts(h.sent[1].buf)).toEqual({ attention: 0, busy: 1 });

    // busy that returns to idle within 2 s never sends
    h.emit("b", "busy");
    vi.advanceTimersByTime(1500);
    h.emit("b", "idle");
    vi.advanceTimersByTime(5000);
    expect(h.sent).toHaveLength(2);

    // idle → idle does not send
    h.emit("c", "idle");
    expect(h.sent).toHaveLength(2);
    led.stop();
  });

  it("sends at once on attention change", () => {
    const h = makeDeps();
    const led = startActivityLed(h.deps);
    h.emit("a", "attention");
    expect(h.sent).toHaveLength(2);
    expect(counts(h.sent[1].buf)).toEqual({ attention: 1, busy: 0 });
    led.stop();
  });

  it("re-sends the last report every 60 s", () => {
    const h = makeDeps();
    const led = startActivityLed(h.deps);
    vi.advanceTimersByTime(30_000);
    h.emit("a", "attention"); // send resets the heartbeat
    expect(h.sent).toHaveLength(2);
    vi.advanceTimersByTime(59_999);
    expect(h.sent).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2].buf.equals(h.sent[1].buf)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(h.sent).toHaveLength(4);
    led.stop();
  });

  it("sends one zero report when toggled off, then nothing", () => {
    const h = makeDeps({ snapshot: [{ sessionId: "a", state: "attention" }] });
    const led = startActivityLed(h.deps);
    expect(h.sent).toHaveLength(1);
    h.setSettings({ enabled: false, host: "10.0.0.9", port: 5000 });
    led.settingsChanged();
    expect(h.sent).toHaveLength(2);
    expect(counts(h.sent[1].buf)).toEqual({ attention: 0, busy: 0 });
    expect(h.sent[1].host).toBe("10.0.0.9");
    expect(h.sent[1].port).toBe(5000);
    h.emit("b", "attention");
    vi.advanceTimersByTime(300_000);
    expect(h.sent).toHaveLength(2);
    led.stop();
  });

  it("sends nothing while disabled", () => {
    const h = makeDeps({ settings: { enabled: false } });
    const led = startActivityLed(h.deps);
    h.emit("a", "attention");
    h.emit("b", "busy");
    vi.advanceTimersByTime(300_000);
    led.settingsChanged(); // still disabled
    expect(h.sent).toHaveLength(0);
    led.stop();
  });

  it("rate-limits send error logging to once a minute", async () => {
    const send = vi.fn<ActivityLedDeps["send"]>(() => Promise.reject(new Error("EHOSTUNREACH")));
    const h = makeDeps({ send });
    const led = startActivityLed(h.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][0]).toContain("EHOSTUNREACH");

    h.emit("a", "attention");
    h.emit("a", "idle");
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(h.log).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000); // heartbeat fails again, a minute later
    expect(h.log).toHaveBeenCalledTimes(2);
    led.stop();
  });

  it("test() sends one attention and one busy", () => {
    const h = makeDeps();
    const led = startActivityLed(h.deps);
    led.test();
    expect(h.sent).toHaveLength(2);
    expect(counts(h.sent[1].buf)).toEqual({ attention: 1, busy: 1 });
    led.stop();
  });
});

describe("activity LED stop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stop() clears timers and unsubscribes", () => {
    const h = makeDeps();
    const led = startActivityLed(h.deps);
    h.emit("a", "busy");
    led.stop();
    expect(h.listeners.size).toBe(0);
    vi.advanceTimersByTime(300_000);
    expect(h.sent).toHaveLength(1);
  });
});
