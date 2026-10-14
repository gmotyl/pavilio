import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTests,
  getActivityState,
  getAttentionSinceAt,
  subscribeActivity,
  subscribeActivityTransitions,
  _applyEventForTests,
} from "../useTerminalActivityChannel";

describe("useTerminalActivityChannel", () => {
  beforeEach(() => _resetForTests());
  afterEach(() => _resetForTests());

  it("stores state from an applied event", () => {
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 });
    expect(getActivityState("s1")).toBe("busy");
  });

  it("stores attentionSinceAt only when state is attention", () => {
    _applyEventForTests({
      sessionId: "s1",
      state: "attention",
      at: 200,
      attentionSinceAt: 150,
    });
    expect(getActivityState("s1")).toBe("attention");
    expect(getAttentionSinceAt("s1")).toBe(150);
    _applyEventForTests({ sessionId: "s1", state: "idle", at: 300 });
    expect(getAttentionSinceAt("s1")).toBeNull();
  });

  it("notifies subscribers", () => {
    const seen: string[] = [];
    subscribeActivity("s1", (state) => seen.push(state));
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 });
    _applyEventForTests({ sessionId: "s1", state: "idle", at: 200 });
    expect(seen).toEqual(["busy", "idle"]);
  });

  it("transition listeners fire with prev and next when the state changes", () => {
    const fn = vi.fn();
    subscribeActivityTransitions(fn);
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 });
    _applyEventForTests({ sessionId: "s1", state: "attention", at: 200 });
    expect(fn.mock.calls).toEqual([
      ["s1", "idle", "busy"],
      ["s1", "busy", "attention"],
    ]);
  });

  it("transition listeners do not fire when the state repeats", () => {
    const fn = vi.fn();
    const seen: string[] = [];
    subscribeActivity("s1", (state) => seen.push(state));
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 });
    subscribeActivityTransitions(fn);
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 200 });
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 300 });
    expect(fn).not.toHaveBeenCalled();
    // Per-session listeners are still notified on every event.
    expect(seen).toEqual(["busy", "busy", "busy"]);
  });

  it("a first event for an unknown session reports prev as idle", () => {
    const fn = vi.fn();
    subscribeActivityTransitions(fn);
    _applyEventForTests({ sessionId: "s2", state: "attention", at: 100 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("s2", "idle", "attention");
  });

  it("a first idle event for an unknown session does not fire a transition", () => {
    const fn = vi.fn();
    subscribeActivityTransitions(fn);
    _applyEventForTests({ sessionId: "s3", state: "idle", at: 100 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("a throwing activity listener does not swallow the transition", () => {
    const fn = vi.fn();
    subscribeActivity("s1", () => {
      throw new Error("listener boom");
    });
    subscribeActivityTransitions(fn);
    expect(() =>
      _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 }),
    ).toThrow("listener boom");
    expect(fn).toHaveBeenCalledWith("s1", "idle", "busy");
  });

  it("unsubscribing a transition listener stops further calls", () => {
    const fn = vi.fn();
    const unsubscribe = subscribeActivityTransitions(fn);
    _applyEventForTests({ sessionId: "s1", state: "busy", at: 100 });
    unsubscribe();
    _applyEventForTests({ sessionId: "s1", state: "attention", at: 200 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
