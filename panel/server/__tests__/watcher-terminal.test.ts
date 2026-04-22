import { describe, expect, it, vi } from "vitest";
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
