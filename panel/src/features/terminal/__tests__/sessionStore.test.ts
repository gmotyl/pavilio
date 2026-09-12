import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../useTerminalSessions";
import {
  __resetSessionStoreForTests,
  getSessions,
  refreshSessions,
  sessionSubscriberCount,
  subscribeSessions,
} from "../sessionStore";

// The store's realtime dependency, stubbed so a test can hand it a frame
// without opening a socket.
const realtime = vi.hoisted(() => {
  const listeners = new Set<(frame: { type: string }) => void>();
  return {
    listeners,
    subscribeRealtime(listener: (frame: { type: string }) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../../realtime/channel", () => ({
  subscribeRealtime: realtime.subscribeRealtime,
}));

function emitFrame(): void {
  for (const listener of [...realtime.listeners]) {
    listener({ type: "file-change" });
  }
}

const session = (id: string, name = id): SessionMeta => ({
  id,
  name,
  project: "pavilio",
  cwd: "/srv/git/pavilio",
  pid: 4242,
  createdAt: "2026-01-01T00:00:00.000Z",
});

let body: SessionMeta[] = [];
let status = 200;
let failure: Error | null = null;

/** Whatever the next fetch should return. A fresh array every time, on purpose. */
function respond(next: SessionMeta[]): void {
  body = next;
  status = 200;
  failure = null;
}

const fetchMock = vi.fn(() => {
  if (failure) return Promise.reject(failure);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
});

/** Let the in-flight fetch settle without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0);

const POLL_MS = 8000;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  respond([]);
});

afterEach(() => {
  __resetSessionStoreForTests();
  realtime.listeners.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal session store", () => {
  it("fetches once and starts polling on the first subscriber", async () => {
    expect(fetchMock).not.toHaveBeenCalled();

    subscribeSessions(vi.fn());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/sessions");

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a later subscriber gets the current list without a second fetch", async () => {
    respond([session("a"), session("b")]);
    subscribeSessions(vi.fn());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    subscribeSessions(late);

    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(getSessions());
    expect(getSessions()).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One poll for the tab, not one per subscriber.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("one refetch per realtime frame regardless of subscriber count", async () => {
    subscribeSessions(vi.fn());
    subscribeSessions(vi.fn());
    subscribeSessions(vi.fn());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    emitFrame();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    emitFrame();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("one refetch per poll tick", async () => {
    subscribeSessions(vi.fn());
    subscribeSessions(vi.fn());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("republishes the same array reference when the id sequence is unchanged", async () => {
    respond([session("a"), session("b")]);
    const listener = vi.fn();
    subscribeSessions(listener);
    await flush();

    const loaded = getSessions();
    expect(loaded).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2); // the empty start, then the list

    // A brand-new payload equal in value to the one already held.
    respond([session("a"), session("b")]);
    await refreshSessions();

    expect(getSessions()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("publishes a new list when a session is added, removed or reordered", async () => {
    respond([session("a"), session("b")]);
    const listener = vi.fn();
    subscribeSessions(listener);
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);

    respond([session("a"), session("b"), session("c")]); // added
    await refreshSessions();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getSessions().map((s) => s.id)).toEqual(["a", "b", "c"]);

    respond([session("a"), session("c")]); // removed
    await refreshSessions();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(getSessions().map((s) => s.id)).toEqual(["a", "c"]);

    respond([session("c"), session("a")]); // reordered
    await refreshSessions();
    expect(listener).toHaveBeenCalledTimes(5);
    expect(getSessions().map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("publishes a new list when a session is renamed", async () => {
    respond([session("a", "pavilio-1"), session("b", "pavilio-2")]);
    const listener = vi.fn();
    subscribeSessions(listener);
    await flush();
    const loaded = getSessions();
    expect(listener).toHaveBeenCalledTimes(2);

    // Same ids, same order, one changed field.
    respond([session("a", "release"), session("b", "pavilio-2")]);
    await refreshSessions();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(getSessions()).not.toBe(loaded);
    expect(getSessions()[0].name).toBe("release");
    expect(listener).toHaveBeenLastCalledWith(getSessions());
  });

  it("keeps the previous list when the fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond([session("a")]);
    const listener = vi.fn();
    subscribeSessions(listener);
    await flush();
    const loaded = getSessions();
    expect(listener).toHaveBeenCalledTimes(2);

    status = 500; // the server answered, badly
    await refreshSessions();
    expect(getSessions()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);

    failure = new Error("network down"); // and then did not answer at all
    await refreshSessions();
    expect(getSessions()).toBe(loaded);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);

    // The poll survives a failed fetch and recovers on the next one.
    respond([session("a"), session("b")]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(getSessions()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(3);

    warn.mockRestore();
  });

  it("ignores a superseded fetch that lands after a newer one", async () => {
    // Two loads in flight at once is the steady state here — a realtime frame or a
    // refresh lands on top of the poll — so the store must honour the last request
    // *issued*, not the last one to resolve.
    const pending: ((list: SessionMeta[]) => void)[] = [];
    const deferred = () =>
      new Promise<Response>((resolve) => {
        pending.push((list) =>
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(list),
          } as unknown as Response),
        );
      });
    fetchMock.mockImplementationOnce(deferred).mockImplementationOnce(deferred);

    subscribeSessions(vi.fn()); // the initial load
    const refreshed = refreshSessions(); // issued on top of it
    expect(pending).toHaveLength(2);

    pending[1]([session("a"), session("b")]); // the newer request answers first
    await flush();
    expect(getSessions().map((s) => s.id)).toEqual(["a", "b"]);

    pending[0]([session("a")]); // and the older one, now stale, second
    await refreshed;
    await flush();

    expect(getSessions().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("the test reset fences a load already in flight", async () => {
    let land!: (list: SessionMeta[]) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          land = (list) =>
            resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(list),
            } as unknown as Response);
        }),
    );

    const listener = vi.fn();
    subscribeSessions(listener);
    listener.mockClear(); // the immediate call with the empty starting list

    __resetSessionStoreForTests();

    // The response the reset was supposed to have fenced off.
    land([session("a")]);
    await flush();

    expect(getSessions()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps polling after the last subscriber leaves", async () => {
    respond([session("a")]);
    const unsubscribe = subscribeSessions(vi.fn());
    await flush();
    expect(sessionSubscriberCount()).toBe(1);

    unsubscribe();

    // The unsubscribe drops the listener; it does not merely stop it being useful.
    expect(sessionSubscriberCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSessions()).toHaveLength(1);

    // And a fresh subscriber joins the still-running store, no second poll.
    const late = vi.fn();
    subscribeSessions(late);
    expect(late).toHaveBeenCalledWith(getSessions());
    expect(sessionSubscriberCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshSessions resolves after subscribers are updated", async () => {
    respond([session("a")]);
    const seen: SessionMeta[][] = [];
    subscribeSessions((list) => {
      seen.push(list);
    });
    await flush();
    expect(seen).toHaveLength(2);

    respond([session("a"), session("b")]);
    await refreshSessions();

    // Already delivered by the time the promise resolves — not a tick later.
    expect(seen).toHaveLength(3);
    expect(seen[2]).toBe(getSessions());
    expect(seen[2]).toHaveLength(2);
  });

  it("the test reset clears the list, subscribers and poll", async () => {
    respond([session("a")]);
    const listener = vi.fn();
    subscribeSessions(listener);
    await flush();
    expect(getSessions()).toHaveLength(1);

    __resetSessionStoreForTests();

    expect(getSessions()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(realtime.listeners.size).toBe(0);

    listener.mockClear();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();

    // The cleared subscriber does not come back with the next store.
    respond([session("b")]);
    subscribeSessions(vi.fn());
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
