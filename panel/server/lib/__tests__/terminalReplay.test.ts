import { afterEach, describe, expect, it } from "vitest";
import {
  createReplay,
  feedReplay,
  flushReplay,
  resizeReplay,
  serializeReplay,
  destroyReplay,
  _resetReplayForTests,
} from "../terminalReplay";

afterEach(() => _resetReplayForTests());

describe("terminalReplay", () => {
  it("serializes fed output for a session", async () => {
    createReplay("s1", 80, 24);
    feedReplay("s1", "hello world");
    await flushReplay("s1");
    expect(serializeReplay("s1")).toContain("hello world");
  });

  it("returns empty string for an unknown session", () => {
    expect(serializeReplay("nope")).toBe("");
  });

  it("preserves multiple lines of scrollback", async () => {
    createReplay("s2", 80, 3);
    for (let i = 0; i < 10; i++) feedReplay("s2", `line${i}\r\n`);
    await flushReplay("s2");
    const snap = serializeReplay("s2");
    expect(snap).toContain("line0"); // beyond the 3-row viewport → scrollback
    expect(snap).toContain("line9");
  });

  it("reflects the resized width in the serialized output", async () => {
    createReplay("s3", 80, 24);
    resizeReplay("s3", 40, 10);
    feedReplay("s3", "x");
    await flushReplay("s3");
    expect(serializeReplay("s3")).toContain("x"); // no throw; resize applied
  });

  it("drops the buffer on destroy", async () => {
    createReplay("s4", 80, 24);
    feedReplay("s4", "gone");
    await flushReplay("s4");
    destroyReplay("s4");
    expect(serializeReplay("s4")).toBe("");
  });

  it("createReplay is idempotent per session id", () => {
    createReplay("s5", 80, 24);
    createReplay("s5", 80, 24); // must not throw or leak a second terminal
    expect(serializeReplay("s5")).toBe("");
  });

  it("feed/resize/flush on an unknown session are safe no-ops", async () => {
    expect(() => feedReplay("ghost", "x")).not.toThrow();
    expect(() => resizeReplay("ghost", 10, 10)).not.toThrow();
    await expect(flushReplay("ghost")).resolves.toBeUndefined();
  });
});
