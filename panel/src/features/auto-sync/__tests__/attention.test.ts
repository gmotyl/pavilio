import { describe, it, expect } from "vitest";
import { attentionTransition, effectiveState } from "../attention";

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
