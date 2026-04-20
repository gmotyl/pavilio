import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetForTests,
  getActivityState,
  getAttentionSinceAt,
  subscribeActivity,
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
});
