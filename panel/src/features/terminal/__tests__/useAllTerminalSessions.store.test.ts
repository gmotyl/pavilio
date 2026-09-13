import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAllTerminalSessions } from "../useAllTerminalSessions";
import { __resetSessionStoreForTests, sessionSubscriberCount } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";
import { getLayoutPresets, readingOrder, type TileLayout } from "../tileLayout";

// The store's realtime dependency, stubbed so nothing opens a socket.
vi.mock("../../realtime/channel", () => ({
  subscribeRealtime: () => () => {},
}));

function session(id: string): SessionMeta {
  return {
    id,
    name: id,
    project: "vector",
    cwd: "/tmp",
    pid: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

let body: SessionMeta[] = [];

/** What the next `GET /api/terminal/sessions` answers. A fresh array every time. */
function respond(ids: string[]): void {
  body = ids.map(session);
}

const fetchMock = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response),
);

/** Let the in-flight fetch land and React commit, without moving the clock. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

const POLL_MS = 8000;
const ORDER_KEY = "panel-terminal-order-__all__";

type Hook = ReturnType<typeof useAllTerminalSessions>;

/** Mounts the hook and counts its renders, so a no-op republish is observable. */
function mountConsumer() {
  const renders = { count: 0 };
  const hook = renderHook(() => {
    renders.count += 1;
    return useAllTerminalSessions();
  });
  return { ...hook, renders };
}

const idsOf = (hook: { result: { current: Hook } }) =>
  hook.result.current.sessions.map((s) => s.id);

const presetFor = (count: number, label: string) =>
  getLayoutPresets(count).find((p) => p.label === label)!;

const tileIds = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  respond([]);
  __resetSessionStoreForTests();
});

afterEach(() => {
  __resetSessionStoreForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAllTerminalSessions over the shared session store", () => {
  it("two consumers share one fetch", async () => {
    respond(["a", "b"]);

    const first = mountConsumer();
    const second = mountConsumer();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/sessions");
    expect(idsOf(first)).toEqual(["a", "b"]);
    expect(idsOf(second)).toEqual(["a", "b"]);
    // The same list object, not two equal copies.
    expect(first.result.current.sessions).toEqual(second.result.current.sessions);

    // One poll for the tab, not one per consumer.
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an unchanged republish does not re-render consumers", async () => {
    respond(["a", "b"]);
    const consumer = mountConsumer();
    await settle();
    const settled = consumer.renders.count;
    const sessions = consumer.result.current.sessions;

    // A brand-new payload equal in value to the one already held, three times over
    // — the steady state of an 8s poll on a quiet tab.
    for (let i = 0; i < 3; i += 1) {
      respond(["a", "b"]);
      await act(async () => {
        await consumer.result.current.refresh();
      });
    }

    expect(consumer.renders.count).toBe(settled);
    expect(consumer.result.current.sessions).toBe(sessions);
  });

  it("a changed list flows through to ordered sessions", async () => {
    // A stored order the server's order disagrees with, so "ordered by the hook's
    // own useTerminalOrdering" is distinguishable from "as the server sent it".
    localStorage.setItem(ORDER_KEY, JSON.stringify(["c", "b", "a"]));
    respond(["a", "b", "c"]);

    const consumer = mountConsumer();
    await settle();
    expect(idsOf(consumer)).toEqual(["c", "b", "a"]);

    respond(["a", "b", "c", "d"]);
    await act(async () => {
      await consumer.result.current.refresh();
    });

    // The new session appends; the stored order still governs the rest.
    expect(idsOf(consumer)).toEqual(["c", "b", "a", "d"]);
  });

  it("refresh triggers exactly one refetch", async () => {
    respond(["a"]);
    const first = mountConsumer();
    const second = mountConsumer();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    respond(["a", "b"]);
    await act(async () => {
      await first.result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(idsOf(first)).toEqual(["a", "b"]);
    expect(idsOf(second)).toEqual(["a", "b"]);
  });

  it("unmounting releases the subscription and leaves the store polling", async () => {
    respond(["a"]);
    const consumer = mountConsumer();
    await settle();
    const atUnmount = consumer.renders.count;
    expect(sessionSubscriberCount()).toBe(1);

    consumer.unmount();

    // Asserted on the store, not on the render count: React swallows a setState on
    // an unmounted component, so an unmoved counter cannot tell a released
    // subscription from a leaked one. A leak here pins this fiber's `setSessions`
    // closure for the life of the tab, and these surfaces remount on every route
    // change.
    expect(sessionSubscriberCount()).toBe(0);

    // The store is tab-scoped: it keeps polling with no subscriber left.
    respond(["a", "b"]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // And the change reached nobody here — the listener went with the unmount.
    expect(consumer.renders.count).toBe(atUnmount);

    // A fresh consumer joins the still-warm store and sees the new list at once.
    const late = mountConsumer();
    expect(idsOf(late)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessionSubscriberCount()).toBe(1);
  });

  it("each consumer keeps its own tiles state", async () => {
    respond(["a", "b", "c"]);
    const first = mountConsumer();
    const second = mountConsumer();
    await settle();

    const before = second.result.current.tiles;
    expect(tileIds(before)).toEqual(["a", "b", "c"]);

    // "3 rows" is deliberately not the default for three sessions.
    act(() => first.result.current.applyPreset(presetFor(3, "3 rows")));

    expect(first.result.current.tiles).not.toEqual(before);
    expect(second.result.current.tiles).toBe(before);
  });
});
