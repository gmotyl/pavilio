import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not a throwing vi.fn: vitest reports an error thrown by a
// mock as a test failure even when the code under test catches it.
let rebuilds = 0;
let rebuildFails = false;
vi.mock("../lib/file-index.js", () => ({
  rebuildIndex: () => {
    rebuilds++;
    if (rebuildFails) throw new Error("ENOENT: scandir");
  },
}));

import { coalesceFileEvents, flushFileEvents } from "../watcher";

describe("coalesceFileEvents", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hands a burst over as one batch once the tree is quiet", () => {
    const flush = vi.fn();
    const push = coalesceFileEvents(100, flush);

    push("unlink", "a/1.md");
    vi.advanceTimersByTime(60);
    push("unlink", "a/2.md");
    vi.advanceTimersByTime(60);
    push("unlinkDir", "a");
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([
      { event: "unlink", path: "a/1.md" },
      { event: "unlink", path: "a/2.md" },
      { event: "unlinkDir", path: "a" },
    ]);
  });

  it("starts a fresh batch after a flush", () => {
    const flush = vi.fn();
    const push = coalesceFileEvents(100, flush);

    push("add", "a.md");
    vi.advanceTimersByTime(100);
    push("change", "b.md");
    vi.advanceTimersByTime(100);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith([{ event: "change", path: "b.md" }]);
  });
});

describe("flushFileEvents", () => {
  beforeEach(() => {
    rebuilds = 0;
    rebuildFails = false;
  });

  it("rebuilds the index once per batch", () => {
    flushFileEvents([
      { event: "add", path: "a.md" },
      { event: "add", path: "b.md" },
    ]);
    expect(rebuilds).toBe(1);
  });

  // It runs from a timer: a throw there is an uncaught exception that took the
  // whole panel down when a project was deleted mid-rebuild.
  it("logs a failed rebuild instead of throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rebuildFails = true;

    expect(() => flushFileEvents([{ event: "unlink", path: "a.md" }])).not.toThrow();
    expect(error).toHaveBeenCalledWith("[watcher] rebuildIndex failed:", expect.any(Error));
    error.mockRestore();
  });
});
