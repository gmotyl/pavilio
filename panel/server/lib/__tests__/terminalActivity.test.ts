import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordOutput,
  recordInput,
  dismiss,
  getState,
  getAllStates,
  subscribe,
  _resetForTests,
  BUSY_THRESHOLD_MS,
  IDLE_DEBOUNCE_MS,
} from "../terminalActivity";

// Simulate a session that stays continuously busy for `durationMs` by
// emitting output in chunks smaller than the idle debounce window. This
// matches how a real long-running command keeps the state machine in
// "busy" until it finally goes quiet.
function stayBusyFor(sessionId: string, durationMs: number): void {
  const chunk = IDLE_DEBOUNCE_MS / 2;
  let elapsed = 0;
  while (elapsed < durationMs) {
    const step = Math.min(chunk, durationMs - elapsed);
    vi.advanceTimersByTime(step);
    recordOutput(sessionId);
    elapsed += step;
  }
}

describe("terminalActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTests();
  });

  it("starts sessions as idle", () => {
    expect(getState("s1")).toBe("idle");
  });

  it("goes busy on output and back to idle after quick silence", () => {
    recordOutput("s1");
    expect(getState("s1")).toBe("busy");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
  });

  it("goes to attention when busy longer than threshold then silent", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
  });

  it("does NOT go to attention for two short, unrelated bursts separated by idle", () => {
    // First short burst
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
    // Much later, another short burst
    vi.advanceTimersByTime(60_000);
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("idle");
  });

  it("dismiss clears attention to idle", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    dismiss("s1");
    expect(getState("s1")).toBe("idle");
  });

  it("input clears attention to idle", () => {
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    recordInput("s1");
    expect(getState("s1")).toBe("idle");
  });

  it("notifies subscribers on every state change", () => {
    const seen: { id: string; state: string }[] = [];
    subscribe((ev) => seen.push({ id: ev.sessionId, state: ev.state }));
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(seen.map((x) => x.state)).toEqual(["busy", "idle"]);
  });

  it("getAllStates returns a snapshot of known sessions", () => {
    recordOutput("s1");
    recordOutput("s2");
    const snap = getAllStates();
    expect(snap.s1).toBe("busy");
    expect(snap.s2).toBe("busy");
  });

  it("a throwing listener does not prevent other listeners from receiving events", () => {
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const seen: string[] = [];
    subscribe(() => {
      throw new Error("listener boom");
    });
    subscribe((ev) => seen.push(ev.state));
    recordOutput("s1");
    expect(seen).toEqual(["busy"]);
    errSpy.mockRestore();
  });

  it("emits attentionSinceAt only when state is attention", () => {
    const seen: any[] = [];
    subscribe((ev) => seen.push(ev));
    recordOutput("s1");
    stayBusyFor("s1", BUSY_THRESHOLD_MS + 100);
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    const attentionEv = seen.find((e) => e.state === "attention");
    const busyEv = seen.find((e) => e.state === "busy");
    expect(typeof attentionEv.attentionSinceAt).toBe("number");
    expect(busyEv.attentionSinceAt).toBeUndefined();
  });
});
