import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBranches } from "../useBranches";

// Stateful stub of the realtime channel so tests can push messages.
const ws = vi.hoisted(() => ({ setLast: (_m: unknown) => {} }));
vi.mock("../../realtime/useWebSocket", () => {
  const React = require("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState(null);
      React.useEffect(() => {
        ws.setLast = setLastMessage;
      }, []);
      return { lastMessage };
    },
  };
});

interface Listing {
  current: string | null;
  local: string[];
  remote: { ref: string; remote: string; name: string }[];
}

const listing = (current: string, local: string[], remote: string[] = []): Listing => ({
  current,
  local,
  remote: remote.map((ref) => {
    const [r, ...rest] = ref.split("/");
    return { ref, remote: r, name: rest.join("/") };
  }),
});

/**
 * Fetch stub keyed by repo: `lists[repo]` is what `/api/git/branches` answers,
 * `fetchAnswer` what `/api/git/fetch` answers. Every call is recorded.
 */
function stubServer(lists: Record<string, Listing>) {
  const state = {
    lists,
    fetchAnswer: { status: 200, body: { ok: true, fetchedAt: 1 } as unknown },
    gates: {} as Record<string, Promise<void> | undefined>,
  };
  const calls: Call[] = [];
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    if (input.startsWith("/api/git/branches")) {
      const repo = new URL(input, "http://x").searchParams.get("repo") ?? "";
      await state.gates[repo];
      const body = state.lists[repo];
      return { ok: !!body, status: body ? 200 : 404, json: async () => body ?? {} } as Response;
    }
    if (input === "/api/git/fetch") {
      const { status, body } = state.fetchAnswer;
      return { ok: status < 300, status, json: async () => body } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", mock);
  return { state, calls };
}

type Call = { url: string; init?: RequestInit };
const branchCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith("/api/git/branches"));
const fetchCalls = (calls: Call[]) => calls.filter((c) => c.url === "/api/git/fetch");

describe("useBranches", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("useBranches lists local and remote for the root", async () => {
    const { calls } = stubServer({ "/r/list": listing("main", ["main", "dev"], ["origin/main", "origin/x"]) });
    const { result } = renderHook(() => useBranches("/r/list"));
    await waitFor(() => expect(result.current.local).toEqual(["main", "dev"]));
    expect(result.current.current).toBe("main");
    expect(result.current.remote).toEqual([
      { ref: "origin/main", remote: "origin", name: "main" },
      { ref: "origin/x", remote: "origin", name: "x" },
    ]);
    expect(result.current.fetchedAt).toBeNull();
    expect(branchCalls(calls)[0].url).toBe(`/api/git/branches?repo=${encodeURIComponent("/r/list")}`);
  });

  it("useBranches re-lists on git-change", async () => {
    const { state } = stubServer({ "/r/ws": listing("main", ["main"]) });
    const { result } = renderHook(() => useBranches("/r/ws"));
    await waitFor(() => expect(result.current.local).toEqual(["main"]));

    state.lists["/r/ws"] = listing("feat", ["main", "feat"]);
    act(() => ws.setLast({ type: "git-change" }));

    await waitFor(() => expect(result.current.local).toEqual(["main", "feat"]));
    expect(result.current.current).toBe("feat");
  });

  it("useBranches fetch sets fetchedAt and re-lists", async () => {
    const { state, calls } = stubServer({ "/r/fetch": listing("main", ["main"]) });
    const { result } = renderHook(() => useBranches("/r/fetch"));
    await waitFor(() => expect(result.current.local).toEqual(["main"]));

    state.lists["/r/fetch"] = listing("main", ["main"], ["origin/new"]);
    let done!: Promise<void>;
    act(() => {
      done = result.current.fetch();
    });
    expect(result.current.fetching).toBe(true);
    await act(() => done);

    expect(result.current.fetching).toBe(false);
    expect(result.current.fetchedAt).toEqual(expect.any(Number));
    expect(result.current.fetchError).toBe("");
    expect(result.current.remote.map((r) => r.ref)).toEqual(["origin/new"]);
    expect(JSON.parse(String(fetchCalls(calls)[0].init?.body))).toEqual({ repo: "/r/fetch" });
  });

  it("useBranches fetch failure keeps lists and sets fetchError", async () => {
    const { state } = stubServer({ "/r/fail": listing("main", ["main"], ["origin/main"]) });
    const { result } = renderHook(() => useBranches("/r/fail"));
    await waitFor(() => expect(result.current.local).toEqual(["main"]));

    state.fetchAnswer = { status: 502, body: { error: "Could not resolve host" } };
    await act(() => result.current.fetch());

    expect(result.current.fetchError).toBe("Could not resolve host");
    expect(result.current.fetching).toBe(false);
    expect(result.current.fetchedAt).toBeNull();
    expect(result.current.local).toEqual(["main"]);
    expect(result.current.remote.map((r) => r.ref)).toEqual(["origin/main"]);
  });

  it("useBranches skips a fetch within ifStaleMs", async () => {
    const { calls } = stubServer({ "/r/stale": listing("main", ["main"]) });
    const { result, unmount } = renderHook(() => useBranches("/r/stale"));
    await waitFor(() => expect(result.current.local).toEqual(["main"]));

    await act(() => result.current.fetch());
    expect(fetchCalls(calls)).toHaveLength(1);
    await act(() => result.current.fetch({ ifStaleMs: 30_000 }));
    expect(fetchCalls(calls)).toHaveLength(1);

    // A remount of the same root shares the last-fetch time.
    unmount();
    const again = renderHook(() => useBranches("/r/stale"));
    await waitFor(() => expect(again.result.current.fetchedAt).toEqual(expect.any(Number)));
    await act(() => again.result.current.fetch({ ifStaleMs: 30_000 }));
    expect(fetchCalls(calls)).toHaveLength(1);

    // Another root has no fetch on record, so it is stale.
    const other = renderHook(() => useBranches("/r/stale-other"));
    await act(() => other.result.current.fetch({ ifStaleMs: 30_000 }));
    expect(fetchCalls(calls)).toHaveLength(2);
  });

  it("useBranches does not leak a previous root's state", async () => {
    const { state } = stubServer({
      "/r/a": listing("a-main", ["a-main"], ["origin/a"]),
      "/r/b": listing("b-main", ["b-main"]),
    });
    const { result, rerender } = renderHook(({ root }) => useBranches(root), {
      initialProps: { root: "/r/a" as string | null },
    });
    await waitFor(() => expect(result.current.local).toEqual(["a-main"]));
    await act(() => result.current.fetch());
    expect(result.current.fetchedAt).toEqual(expect.any(Number));

    // Hold b's listing so the in-between render is observable.
    let release!: () => void;
    state.gates["/r/b"] = new Promise<void>((r) => (release = r));
    rerender({ root: "/r/b" });
    expect(result.current.local).toEqual([]);
    expect(result.current.remote).toEqual([]);
    expect(result.current.current).toBeNull();
    expect(result.current.fetchedAt).toBeNull();

    // A slow answer for a left root never lands on the new one.
    let releaseA!: () => void;
    state.gates["/r/a"] = new Promise<void>((r) => (releaseA = r));
    rerender({ root: "/r/a" });
    rerender({ root: "/r/b" });
    await act(async () => release());
    await waitFor(() => expect(result.current.local).toEqual(["b-main"]));
    await act(async () => releaseA());
    expect(result.current.local).toEqual(["b-main"]);
    expect(result.current.current).toBe("b-main");
  });
});
