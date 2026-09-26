import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimeChannelForTests,
  REALTIME_RECONNECT_FRAME,
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
  private openHandler: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  /**
   * A socket that opened immediately has already completed its handshake by
   * the time the channel attaches its handler, so attaching runs it — that is
   * what `initialReadyState = OPEN` means. One held at CONNECTING waits for
   * `open()`.
   */
  set onopen(handler: (() => void) | null) {
    this.openHandler = handler;
    if (this.readyState === FakeWebSocket.OPEN) handler?.();
  }

  get onopen(): (() => void) | null {
    return this.openHandler;
  }

  /** Finish a handshake that was held at CONNECTING. */
  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.openHandler?.();
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

  it("creates exactly one socket when the return events land milliseconds apart", () => {
    subscribeRealtime(vi.fn());
    last().readyState = FakeWebSocket.CLOSED;
    // The replacement is still mid-handshake when the second event lands.
    FakeWebSocket.initialReadyState = FakeWebSocket.CONNECTING;

    window.dispatchEvent(new Event("pageshow"));
    // A bfcache restore fires its events in separate tasks, and `online` can
    // trail a `visibilitychange` by a few ms. The clock moves between them.
    vi.advanceTimersByTime(5);
    window.dispatchEvent(new Event("online"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(last().closed).toBe(false);
  });

  it("replaces a CONNECTING socket that predates a return after the clock jumps back", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    ws.readyState = FakeWebSocket.CONNECTING;
    // An NTP correction (or a user fixing the clock) during the freeze: the
    // socket now reads as created in the future, but it is still stranded.
    vi.setSystemTime(Date.now() - 60_000);

    document.dispatchEvent(new Event("visibilitychange"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(ws.closed).toBe(true);
  });

  it("a return inside the reconnect window disarms the pending reconnect", () => {
    subscribeRealtime(vi.fn());
    const ws = last();
    ws.close(); // `onclose` was delivered, so the 2s reconnect is armed
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(500); // the user comes back inside that window
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // The armed timer must be gone: firing it would open a third socket and
    // orphan the replacement, which stays OPEN but is no longer `socket`, so
    // its own `onclose` is a no-op — a live socket nothing can ever close.
    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(last().closed).toBe(false);
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
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });
    expect(frames).toHaveLength(0);

    vi.advanceTimersByTime(40_000); // watchdog closes the stale socket
    vi.advanceTimersByTime(2_000); // reconnect

    expect(frames.filter((frame) => frame.type === "file-change")).toEqual([
      { type: "file-change", event: "reconnect", path: "" },
    ]);
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

    const fileChanges = frames.filter((frame) => frame.type === "file-change");
    expect(fileChanges).toHaveLength(2);
    expect(fileChanges[1]).toEqual(fileChanges[0]);
    // Equal in value but never the same object: consumers key their effects off
    // `lastMessage` identity, so a shared one would skip the second refetch.
    expect(fileChanges[1]).not.toBe(fileChanges[0]);

    // The neutral frame carries the same promise, and it is the easier one to
    // lose: publishing the exported constant itself typechecks and reads fine.
    const neutral = frames.filter(
      (frame) => frame.type === REALTIME_RECONNECT_FRAME.type,
    );
    expect(neutral).toHaveLength(2);
    expect(neutral[1]).toEqual(neutral[0]);
    expect(neutral[1]).not.toBe(neutral[0]);
    expect(neutral[0]).not.toBe(REALTIME_RECONNECT_FRAME);
  });

  it("publishes the neutral reconnect frame on the second connection", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    vi.advanceTimersByTime(40_000); // watchdog closes the stale socket
    vi.advanceTimersByTime(2_000); // reconnect

    expect(frames).toContainEqual({ ...REALTIME_RECONNECT_FRAME });
    // The literal, spelled out once: every other assertion here goes through
    // the import, so renaming the string would leave the suite green while
    // every consumer of the wire value stopped hearing the frame.
    expect(frames).toContainEqual({ type: "realtime-reconnect" });
  });

  it("publishes nothing for an attempt that never opens, then one pair for the connect that does", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    // The server goes down: the socket closes and the retry dies in the
    // handshake. An attempt is not a reconnect — nothing was recovered, and a
    // published frame here costs every consumer a refetch against a dead
    // server, `/api/speech/latest` included.
    last().close();
    FakeWebSocket.initialReadyState = FakeWebSocket.CONNECTING;
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(frames).toEqual([]);

    last().close(); // the attempt fails without ever opening
    expect(frames).toEqual([]);

    // The server comes back. One reconnect, one pair of frames.
    FakeWebSocket.initialReadyState = FakeWebSocket.OPEN;
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(frames.map((frame) => frame.type)).toEqual(["realtime-reconnect", "file-change"]);
  });

  it("publishes the pair when a held handshake finally opens, not when it started", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    last().close();
    FakeWebSocket.initialReadyState = FakeWebSocket.CONNECTING;
    vi.advanceTimersByTime(2_000);
    expect(frames).toEqual([]);

    last().open();

    expect(frames.map((frame) => frame.type)).toEqual(["realtime-reconnect", "file-change"]);
  });

  it("publishes no reconnect frame on the first connection", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    expect(frames).toHaveLength(0);
  });

  it("still publishes the file-change reconnect frame alongside the neutral one", () => {
    const frames: RealtimeFrame[] = [];
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    vi.advanceTimersByTime(40_000);
    vi.advanceTimersByTime(2_000);

    expect(frames).toHaveLength(2);
    // The existing frame is untouched: its consumers still match on `path`.
    expect(frames).toContainEqual({ type: "file-change", event: "reconnect", path: "" });
    expect(frames).toContainEqual({ ...REALTIME_RECONNECT_FRAME });
  });

  it("a throwing subscriber does not stop the other reconnect frame reaching others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Breaks on the file-change frame only; the neutral one must still land.
    const throws = vi.fn((frame: RealtimeFrame) => {
      if (frame.type === "file-change") throw new Error("subscriber boom");
    });
    const frames: RealtimeFrame[] = [];
    subscribeRealtime(throws);
    subscribeRealtime((frame) => {
      frames.push(frame);
    });

    vi.advanceTimersByTime(40_000);
    vi.advanceTimersByTime(2_000);

    expect(frames).toContainEqual({ type: "file-change", event: "reconnect", path: "" });
    expect(frames).toContainEqual({ ...REALTIME_RECONNECT_FRAME });
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
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

  it("the test reset leaves no return listener behind", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    subscribeRealtime(vi.fn());
    const onPageshow = addSpy.mock.calls.find(([type]) => type === "pageshow")?.[1];
    const onOnline = addSpy.mock.calls.find(([type]) => type === "online")?.[1];
    expect(onPageshow).toBeTypeOf("function");
    expect(onOnline).toBe(onPageshow); // one handler for all three return events
    const removeSpy = vi.spyOn(window, "removeEventListener");

    __resetRealtimeChannelForTests();

    // Asserted on the detach itself, and with the very handle that was added:
    // the reset also nulls `socket` and clears `started`, which makes a
    // surviving listener inert *in this file*. What it leaks is a handler into
    // whichever file runs next, and only the removal call can prove that gone.
    expect(removeSpy).toHaveBeenCalledWith("pageshow", onPageshow);
    expect(removeSpy).toHaveBeenCalledWith("online", onOnline);

    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
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
