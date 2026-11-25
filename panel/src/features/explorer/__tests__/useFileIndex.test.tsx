import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { useFileIndex, useFileIndexState } from "../useFileIndex";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

const ENTRY = { relativePath: "pavilio/qa/stories/pavilio-pr-7.md", modified: 1 };

/** Answers each index fetch with the next queued outcome; the last one repeats. */
function queueFetch(outcomes: (() => Promise<Response>)[]) {
  const mock = vi.fn(() => (outcomes.length > 1 ? outcomes.shift()! : outcomes[0])());
  vi.stubGlobal("fetch", mock);
  return mock;
}
const notOk = () => Promise.resolve(new Response("boom", { status: 500 }));
const rejected = () => Promise.reject(new TypeError("Failed to fetch"));
const badJson = () => Promise.resolve(new Response("not json", { status: 200 }));
const ok = () => Promise.resolve(jsonResponse([ENTRY]));

/** Lets the pending fetch and its state updates settle. */
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useFileIndexState", () => {
  it.each([
    ["a non-OK response", notOk],
    ["a rejected fetch", rejected],
    ["a body that is not JSON", badJson],
  ])("%s on the first load reports an error and stays not loaded", async (_, fail) => {
    queueFetch([fail]);
    const { result } = renderHook(() => useFileIndexState());
    await flush();
    expect(result.current).toEqual({ files: [], loaded: false, error: true });
  });

  it("retries a failed first load until it succeeds, then clears the error", async () => {
    const fetch = queueFetch([notOk, rejected, ok]);
    const { result } = renderHook(() => useFileIndexState());
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    await advance(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(true);

    await advance(5_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBe(false);
    expect(result.current.files.map((f) => f.relativePath)).toEqual([ENTRY.relativePath]);

    // Loaded: no more retries.
    await advance(120_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("backs off 2s, 5s, 10s, then every 30s", async () => {
    const fetch = queueFetch([notOk]);
    renderHook(() => useFileIndexState());
    await flush();
    for (const [ms, calls] of [
      [2_000, 2],
      [5_000, 3],
      [10_000, 4],
      [30_000, 5],
      [30_000, 6],
    ] as const) {
      await advance(ms - 1);
      expect(fetch).toHaveBeenCalledTimes(calls - 1);
      await advance(1);
      expect(fetch).toHaveBeenCalledTimes(calls);
    }
  });

  it("unmounting clears the pending retry", async () => {
    const fetch = queueFetch([notOk]);
    const { unmount } = renderHook(() => useFileIndexState());
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("useFileIndex still returns just the files", async () => {
    queueFetch([ok]);
    const { result } = renderHook(() => useFileIndex());
    await flush();
    expect(result.current).toEqual([{ ...ENTRY, project: "pavilio", archived: false, root: "projects" }]);
  });
});
