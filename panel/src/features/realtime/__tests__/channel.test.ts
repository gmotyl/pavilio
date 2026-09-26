import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimeChannelForTests,
  type RealtimeFrame,
  realtimeSubscriberCount,
  subscribeRealtime,
} from "../channel";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  /** What the next socket opens as; raise to CONNECTING to hold a handshake. */
  static initialReadyState = 1;

  readyState = FakeWebSocket.initialReadyState; // open immediately by default; the real one opens async
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  closeCount = 0;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCount += 1;
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  /** Simulate a server frame. */
  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Simulate a frame the server sent that is not JSON. */
  deliverRaw(data: string): void {
    this.onmessage?.({ data });
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

let visibility = "visible";

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.initialReadyState = FakeWebSocket.OPEN;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  __resetRealtimeChannelForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("realtime channel", () => {
  it("opens one socket for many subscribers", () => {
    subscribeRealtime(vi.fn());
    subscribeRealtime(vi.fn());
    subscribeRealtime(vi.fn());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(realtimeSubscriberCount()).toBe(3);
  });

  it("opens nothing until the first subscriber", () => {
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(realtimeSubscriberCount()).toBe(0);

    subscribeRealtime(vi.fn());

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("delivers a frame to every current subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeRealtime(a);
    subscribeRealtime(b);

    last().deliver({ type: "file-change", path: "/a.md" });

    expect(a).toHaveBeenCalledWith({ type: "file-change", path: "/a.md" });
    expect(b).toHaveBeenCalledWith({ type: "file-change", path: "/a.md" });
  });

  it("does not replay an earlier frame to a late subscriber", () => {
    subscribeRealtime(vi.fn());
    last().deliver({ type: "file-change", path: "/a.md" });

    const late = vi.fn();
    subscribeRealtime(late);

    expect(late).not.toHaveBeenCalled();
  });

  it("delivers nothing to a resubscribed listener with no new frame", () => {
    const listener = vi.fn();
    subscribeRealtime(listener)();
    subscribeRealtime(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it("an unsubscribed listener stops receiving, the rest continue", () => {
    const gone = vi.fn();
    const stays = vi.fn();
    const unsubscribe = subscribeRealtime(gone);
    subscribeRealtime(stays);

    unsubscribe();
    last().deliver({ type: "ping" });

    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);
  });

  it("keeps the socket open when the last subscriber leaves", () => {
    const unsubscribe = subscribeRealtime(vi.fn());

    unsubscribe();

    expect(realtimeSubscriberCount()).toBe(0);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
  });

  it("reuses the open socket for a later subscriber", () => {
    subscribeRealtime(vi.fn())();

    const later = vi.fn();
    subscribeRealtime(later);
    last().deliver({ type: "ping" });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("closes a stale socket once and reconnects", () => {
    subscribeRealtime(vi.fn());

    vi.advanceTimersByTime(40_000); // past the stale window
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[0].closeCount).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2_000); // reconnect backoff
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].closeCount).toBe(1);
  });

  it("re-checks freshness when the tab is foregrounded", () => {
    subscribeRealtime(vi.fn());

    // Background: timers are throttled in real browsers, so simulate the gap
    // without letting the watchdog interval run.
    visibility = "hidden";
    vi.setSystemTime(Date.now() + 300_000);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("reconnects a CLOSED socket on return when no close event was delivered", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    // The frozen tab ran no JS: the socket died without ever firing `close`, so
    // nothing armed the reconnect and the watchdog bails forever.
    ws.readyState = FakeWebSocket.CLOSED;

    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("replaces a CONNECTING socket that predates the return", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    ws.readyState = FakeWebSocket.CONNECTING;
    vi.setSystemTime(Date.now() + 60_000); // the freeze, spent mid-handshake

    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(ws.closed).toBe(true);
  });

  it("leaves a CONNECTING socket created by the return itself alone", () => {
    subscribeRealtime(vi.fn());
    last().close(); // arms the 2s reconnect
    FakeWebSocket.initialReadyState = FakeWebSocket.CONNECTING;
    vi.advanceTimersByTime(2_000); // the ordinary reconnect, opened just now
    expect(FakeWebSocket.instances).toHaveLength(2);

    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(last().closed).toBe(false);
  });

  it("leaves an OPEN socket within the freshness window untouched on return", () => {
    subscribeRealtime(vi.fn());
    const ws = last();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(ws.closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes an OPEN socket silent past STALE_MS on return", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    vi.setSystemTime(Date.now() + 60_000);

    document.dispatchEvent(new Event("visibilitychange"));

    expect(ws.closed).toBe(true);
    // Unchanged: the existing close handler owns the reconnect.
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("treats pageshow as a return", () => {
    subscribeRealtime(vi.fn());
    last().readyState = FakeWebSocket.CLOSED;

    // Restored from the back/forward cache: no visibility change accompanies it.
    window.dispatchEvent(new Event("pageshow"));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("treats online as a return", () => {
    subscribeRealtime(vi.fn());
    last().readyState = FakeWebSocket.CLOSED;

    window.dispatchEvent(new Event("online"));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("creates exactly one socket when pageshow and visibilitychange land together", () => {
    subscribeRealtime(vi.fn());
    last().readyState = FakeWebSocket.CLOSED;
    // The replacement is still mid-handshake when the second event lands.
    FakeWebSocket.initialReadyState = FakeWebSocket.CONNECTING;

    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("a replaced socket does not arm a reconnect", () => {
    subscribeRealtime(vi.fn());
    const stranded = last();
    stranded.readyState = FakeWebSocket.CONNECTING;
    vi.setSystemTime(Date.now() + 60_000);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(5_000); // past RECONNECT_MS
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("ignores a visibilitychange to hidden", () => {
    subscribeRealtime(vi.fn());
    last().readyState = FakeWebSocket.CLOSED;
    visibility = "hidden";

    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("publishes the reconnect frame on the second connect, not the first", () => {
    const listener = vi.fn();
    subscribeRealtime(listener);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(40_000); // watchdog closes the stale socket
    vi.advanceTimersByTime(2_000); // reconnect

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "file-change", event: "reconnect", path: "" }),
    );
  });

  it("gives every reconnect frame its own object", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    // Two reconnects with no data frame in between: server down, reconnect,
    // silence past the stale window, watchdog, reconnect again.
    vi.advanceTimersByTime(40_000);
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(40_000);
    vi.advanceTimersByTime(2_000);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toEqual(frames[0]);
    // Equal in value but never the same object: consumers key their effects off
    // `lastMessage` identity, so a shared one would skip the second refetch.
    expect(frames[1]).not.toBe(frames[0]);
  });

  it("ignores a non-JSON message", () => {
    const listener = vi.fn();
    subscribeRealtime(listener);

    last().deliverRaw("not json");
    last().deliver({ type: "ping" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "ping" });
  });

  it("keeps delivering to later subscribers when an earlier one throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throws = vi.fn(() => {
      throw new Error("subscriber boom");
    });
    const good = vi.fn();
    subscribeRealtime(throws);
    subscribeRealtime(good);

    last().deliver({ type: "file-change", path: "/a.md" });

    expect(throws).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledWith({ type: "file-change", path: "/a.md" });
    expect(warn).toHaveBeenCalled();

    // The channel survives the failure: the next frame still lands.
    last().deliver({ type: "ping" });
    expect(good).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it("an arriving frame refreshes the staleness window", () => {
    subscribeRealtime(vi.fn());
    const ws = last();

    // 100s of traffic, well past the 35s window, one frame every 20s.
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(20_000);
      ws.deliver({ type: "ping" });
    }

    expect(ws.closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("the test reset tears an open socket down without arming a reconnect", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    expect(ws.closed).toBe(false);

    __resetRealtimeChannelForTests();

    expect(ws.closed).toBe(true);
    expect(realtimeSubscriberCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("the test reset closes the socket and clears subscribers and timers", () => {
    subscribeRealtime(vi.fn());
    vi.advanceTimersByTime(40_000); // leaves a reconnect timer armed

    __resetRealtimeChannelForTests();

    expect(realtimeSubscriberCount()).toBe(0);
    expect(FakeWebSocket.instances.every((ws) => ws.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
