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
    vi.advanceTimersByTime(BUSY_THRESHOLD_MS + 100);
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
  });

  it("dismiss clears attention to idle", () => {
    recordOutput("s1");
    vi.advanceTimersByTime(BUSY_THRESHOLD_MS + 100);
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    expect(getState("s1")).toBe("attention");
    dismiss("s1");
    expect(getState("s1")).toBe("idle");
  });

  it("input clears attention to idle", () => {
    recordOutput("s1");
    vi.advanceTimersByTime(BUSY_THRESHOLD_MS + 100);
    recordOutput("s1");
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

  it("emits attentionSinceAt only when state is attention", () => {
    const seen: any[] = [];
    subscribe((ev) => seen.push(ev));
    recordOutput("s1");
    vi.advanceTimersByTime(BUSY_THRESHOLD_MS + 100);
    recordOutput("s1");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS);
    const attentionEv = seen.find((e) => e.state === "attention");
    const busyEv = seen.find((e) => e.state === "busy");
    expect(typeof attentionEv.attentionSinceAt).toBe("number");
    expect(busyEv.attentionSinceAt).toBeUndefined();
  });
});
