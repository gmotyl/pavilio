import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import * as terminalManager from "../lib/terminal-manager";
import { attachTerminalSocket } from "../watcher";

// Minimal fake WebSocket for handler tests.
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

describe("attachTerminalSocket — mobile-nudge", () => {
  it("routes mobile-nudge messages to nudgeSession", () => {
    vi.spyOn(terminalManager, "getSession").mockReturnValue({
      id: "s1",
      name: "s1",
      color: null,
      project: "p",
      cwd: "/",
      pid: 1,
      createdAt: "",
      pty: {
        onData: () => ({ dispose: () => {} }),
        onExit: () => ({ dispose: () => {} }),
        write: () => {},
        resize: () => {},
        kill: () => {},
      } as never,
    });
    const nudge = vi
      .spyOn(terminalManager, "nudgeSession")
      .mockReturnValue(true);

    const ws = new FakeWs() as never;
    attachTerminalSocket(ws, "s1");
    (ws as unknown as FakeWs).emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "mobile-nudge", cols: 120, rows: 40 }),
      ),
    );

    expect(nudge).toHaveBeenCalledWith("s1", 120, 40);
  });
});

function mockGetSession(): void {
  vi.spyOn(terminalManager, "getSession").mockReturnValue({
    id: "s1",
    name: "s1",
    color: null,
    project: "p",
    cwd: "/",
    pid: 1,
    createdAt: "",
    pty: {
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      write: () => {},
      resize: () => {},
      kill: () => {},
    } as never,
  });
}

describe("attachTerminalSocket — heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetSession();
  });
  afterEach(() => vi.useRealTimers());

  it("sends {type:'ping'} every 10 seconds while open", () => {
    const ws = new FakeWs() as never;
    attachTerminalSocket(ws, "s1");

    vi.advanceTimersByTime(10_000);
    expect(
      (ws as unknown as FakeWs).sent.some(
        (m) => JSON.parse(m).type === "ping",
      ),
    ).toBe(true);

    const before = (ws as unknown as FakeWs).sent.length;
    vi.advanceTimersByTime(10_000);
    expect((ws as unknown as FakeWs).sent.length).toBeGreaterThan(before);
  });

  it("stops the heartbeat on close", () => {
    const ws = new FakeWs() as never;
    attachTerminalSocket(ws, "s1");
    (ws as unknown as FakeWs).emit("close");
    const before = (ws as unknown as FakeWs).sent.length;
    vi.advanceTimersByTime(30_000);
    expect((ws as unknown as FakeWs).sent.length).toBe(before);
  });
});
