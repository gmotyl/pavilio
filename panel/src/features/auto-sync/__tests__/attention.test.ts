import { describe, it, expect, beforeEach } from "vitest";
import { attentionTransition, effectiveState, observeTransition, resetAttentionForTest } from "../attention";

describe("attentionTransition", () => {
  it("fires on entering an attention state", () => {
    expect(attentionTransition("synced", { state: "conflict" })).toBe("conflict");
    expect(attentionTransition("idle", { state: "push-failed" })).toBe("push-failed");
    expect(attentionTransition("synced", { state: "synced", stale: true })).toBe("stale");
  });
  it("does not fire on first observation (page load)", () => {
    expect(attentionTransition(null, { state: "conflict" })).toBe(null);
  });
  it("does not refire while state is unchanged", () => {
    expect(attentionTransition("conflict", { state: "conflict" })).toBe(null);
    expect(attentionTransition("stale", { state: "offline", stale: true })).toBe(null);
  });
  it("ignores non-attention states", () => {
    expect(attentionTransition("synced", { state: "syncing" })).toBe(null);
    expect(attentionTransition("conflict", { state: "synced" })).toBe(null);
  });
  it("effectiveState: stale wins over the raw state", () => {
    expect(effectiveState({ state: "synced", stale: true })).toBe("stale");
    expect(effectiveState({ state: "offline" })).toBe("offline");
  });
});

describe("observeTransition (shared module-scope state)", () => {
  beforeEach(() => {
    resetAttentionForTest();
  });

  it("does not fire on the very first observation ever (page load)", () => {
    expect(observeTransition({ state: "conflict" })).toBe(null);
  });

  it("dedupes concurrent hook instances polling the same backend state", () => {
    observeTransition({ state: "synced" });
    // sidebar instance polls first
    expect(observeTransition({ state: "conflict" })).toBe("conflict");
    // modal instance polls immediately after with the same status
    expect(observeTransition({ state: "conflict" })).toBe(null);
  });
});
