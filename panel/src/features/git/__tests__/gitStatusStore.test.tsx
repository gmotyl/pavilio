import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  __resetGitStatusStoreForTests,
  getGitStatusSnapshot,
  requestGitStatusRefresh,
  subscribeGitStatus,
} from "../gitStatusStore";
import { useGitStatus } from "../useGitStatus";
import {
  __resetRealtimeChannelForTests,
  realtimeSubscriberCount,
} from "../../realtime/channel";
import {
  _applyEventForTests,
  _resetForTests as resetActivity,
} from "../../terminal/useTerminalActivityChannel";

/** Minimal socket: the realtime channel opens one, the test pushes frames into it. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.readyState = 3;
  }
}

function pushFrame(frame: object): void {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no realtime socket was opened");
  ws.onmessage?.({ data: JSON.stringify(frame) });
}

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };

/** fetch stub whose calls stay pending until the test settles them. */
function deferredFetch() {
  const pending: Deferred[] = [];
  const fn = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { fn, pending };
}

function ok(files: { status: string; path: string }[]): Response {
  return new Response(JSON.stringify(files), { status: 200 });
}

function statusCalls(fn: ReturnType<typeof vi.fn>): number {
  return fn.mock.calls.filter(([url]) => String(url).startsWith("/api/git/status")).length;
}

function Consumer({ id }: { id: string }) {
  const { files } = useGitStatus();
  return <div data-testid={id}>{files.map((f) => f.path).join(",")}</div>;
}

let baseline = 0;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  __resetRealtimeChannelForTests();
  resetActivity();
  __resetGitStatusStoreForTests();
  baseline = realtimeSubscriberCount();
});

afterEach(() => {
  __resetGitStatusStoreForTests();
  __resetRealtimeChannelForTests();
  resetActivity();
  vi.unstubAllGlobals();
});

describe("gitStatusStore", () => {
  it("several consumers share one status request", async () => {
    const fetchMock = vi.fn(async () => ok([{ status: "M", path: "a.md" }]));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <Consumer id="c1" />
        <Consumer id="c2" />
        <Consumer id="c3" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId("c3")).toHaveTextContent("a.md"));
    expect(screen.getByTestId("c1")).toHaveTextContent("a.md");
    expect(screen.getByTestId("c2")).toHaveTextContent("a.md");
    expect(statusCalls(fetchMock)).toBe(1);
  });

  it("never requests suggest-message", async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);

    const unsub = subscribeGitStatus(() => {});
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(1));
    act(() => pushFrame({ type: "git-change" }));
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(2));
    unsub();

    const urls = fetchMock.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls.some((u) => u.includes("suggest-message"))).toBe(false);
  });

  it("file-change frame triggers one refetch", async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);

    const unsub = subscribeGitStatus(() => {});
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(1));

    pushFrame({ type: "file-change", path: "x.md" });
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(2));

    // Unrelated frames are ignored.
    pushFrame({ type: "sync-status" });
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fetchMock)).toBe(2);
    unsub();
  });

  it("transition into attention triggers one refetch", async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);

    const unsub = subscribeGitStatus(() => {});
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(1));

    _applyEventForTests({ sessionId: "s1", state: "busy", at: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fetchMock)).toBe(1);

    _applyEventForTests({ sessionId: "s1", state: "attention", at: 2 });
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(2));
    unsub();
  });

  it("repeated attention events do not refetch", async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);

    const unsub = subscribeGitStatus(() => {});
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(1));

    _applyEventForTests({ sessionId: "s1", state: "attention", at: 1 });
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(2));

    for (let i = 0; i < 5; i++) {
      _applyEventForTests({ sessionId: "s1", state: "attention", at: 2 + i });
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fetchMock)).toBe(2);
    unsub();
  });

  it("triggers during an in-flight request coalesce into one trailing fetch", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    const unsub = subscribeGitStatus(() => {});
    expect(statusCalls(fn)).toBe(1);

    pushFrame({ type: "file-change", path: "a" });
    pushFrame({ type: "git-change" });
    requestGitStatusRefresh();
    expect(statusCalls(fn)).toBe(1);

    pending[0].resolve(ok([]));
    await waitFor(() => expect(statusCalls(fn)).toBe(2));

    pending[1].resolve(ok([]));
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fn)).toBe(2);
    unsub();
  });

  it("a resubscribe while a fetch is in flight does not queue a second fetch", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);
    const listener = vi.fn();

    // StrictMode mounts, unmounts and remounts an effect in one tick.
    subscribeGitStatus(listener)();
    const unsub = subscribeGitStatus(listener);
    expect(statusCalls(fn)).toBe(1);

    pending[0].resolve(ok([{ status: "M", path: "a.md" }]));
    await waitFor(() => expect(listener).toHaveBeenCalled());
    expect(getGitStatusSnapshot().files.map((f) => f.path)).toEqual(["a.md"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fn)).toBe(1);
    unsub();
  });

  it("a later remount during an in-flight request fetches again once it settles", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    subscribeGitStatus(() => {})();
    // A later tick: changes made while detached went unheard.
    await new Promise((r) => setTimeout(r, 0));
    const unsub = subscribeGitStatus(() => {});
    expect(statusCalls(fn)).toBe(1);

    pending[0].resolve(ok([{ status: "M", path: "old.md" }]));
    await waitFor(() => expect(statusCalls(fn)).toBe(2));
    pending[1].resolve(ok([{ status: "M", path: "new.md" }]));
    await waitFor(() =>
      expect(getGitStatusSnapshot().files.map((f) => f.path)).toEqual(["new.md"]),
    );
    unsub();
  });

  it("no trailing fetch after the last consumer unsubscribes", async () => {
    const { fn, pending } = deferredFetch();
    vi.stubGlobal("fetch", fn);

    const unsub = subscribeGitStatus(() => {});
    requestGitStatusRefresh();
    unsub();

    pending[0].resolve(ok([]));
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fn)).toBe(1);

    // The next consumer still gets a fresh read.
    const unsub2 = subscribeGitStatus(() => {});
    expect(statusCalls(fn)).toBe(2);
    pending[1].resolve(ok([]));
    unsub2();
  });

  it("a failed fetch keeps the previous files", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([{ status: "M", path: "keep.md" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const unsub = subscribeGitStatus(() => {});
    await waitFor(() => expect(getGitStatusSnapshot().files).toHaveLength(1));

    requestGitStatusRefresh();
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(getGitStatusSnapshot().files.map((f) => f.path)).toEqual(["keep.md"]);

    requestGitStatusRefresh();
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(getGitStatusSnapshot().files.map((f) => f.path)).toEqual(["keep.md"]);
    unsub();
  });

  it("last unsubscribe detaches listeners", async () => {
    const fetchMock = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(
      <>
        <Consumer id="c1" />
        <Consumer id="c2" />
      </>,
    );
    await waitFor(() => expect(statusCalls(fetchMock)).toBe(1));
    expect(realtimeSubscriberCount()).toBe(baseline + 1);

    unmount();
    expect(realtimeSubscriberCount()).toBe(baseline);

    // Detached: neither trigger reaches the store any more.
    pushFrame({ type: "git-change" });
    _applyEventForTests({ sessionId: "s1", state: "attention", at: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(statusCalls(fetchMock)).toBe(1);

    // Snapshot identity is stable between changes.
    expect(getGitStatusSnapshot()).toBe(getGitStatusSnapshot());
  });
});
