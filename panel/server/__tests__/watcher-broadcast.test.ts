import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { attachBroadcastSocket } from "../watcher";

// Minimal fake WebSocket for handler tests (same shape as watcher-terminal).
class FakeWs extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(msg: string): void {
    this.sent.push(msg);
  }
  close(): void {
    this.readyState = 3;
  }
}

const types = (ws: FakeWs) => ws.sent.map((m) => JSON.parse(m).type);

describe("attachBroadcastSocket", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("greets with {type:'connected'}", () => {
    const ws = new FakeWs();
    attachBroadcastSocket(ws as never);
    expect(types(ws)).toEqual(["connected"]);
  });

  it("pings every 10 seconds so a half-open socket is detectable", () => {
    const ws = new FakeWs();
    attachBroadcastSocket(ws as never);

    vi.advanceTimersByTime(10_000);
    expect(types(ws).filter((t) => t === "ping")).toHaveLength(1);

    vi.advanceTimersByTime(20_000);
    expect(types(ws).filter((t) => t === "ping")).toHaveLength(3);
  });

  it("stops pinging on close", () => {
    const ws = new FakeWs();
    attachBroadcastSocket(ws as never);
    ws.emit("close");
    const before = ws.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(ws.sent).toHaveLength(before);
  });

  it("stops pinging and closes on error", () => {
    const ws = new FakeWs();
    attachBroadcastSocket(ws as never);
    ws.emit("error", new Error("boom"));

    expect(ws.readyState).toBe(3);
    const before = ws.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(ws.sent).toHaveLength(before);
  });

  it("does not send once the socket is no longer OPEN", () => {
    const ws = new FakeWs();
    attachBroadcastSocket(ws as never);
    ws.readyState = 3;
    const before = ws.sent.length;
    vi.advanceTimersByTime(30_000);
    expect(ws.sent).toHaveLength(before);
  });
});
