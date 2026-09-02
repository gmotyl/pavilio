import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub out xterm + its addons before importing the module under test. jsdom
// does not implement the terminal surface xterm expects (ResizeObserver,
// canvas measurements, etc.) and we only care about ws lifecycle here.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    refresh = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn((_cb: (data: string) => void) => ({
      dispose: vi.fn(),
    }));
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

interface FakeWs {
  url: string;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
}

const createdSockets: FakeWs[] = [];

class FakeWebSocket implements FakeWs {
  url: string;
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    createdSockets.push(this);
  }
}

describe("terminalInstances", () => {
  beforeEach(async () => {
    createdSockets.length = 0;
    vi.resetModules();
    const mod = await import("../terminalInstances");
    mod.__setWebSocketCtorForTests(
      FakeWebSocket as unknown as new (url: string) => WebSocket,
    );
  });

  afterEach(async () => {
    // Clean up any instance left behind so tests don't leak across each
    // other (instances are keyed by sessionId at module scope).
    const mod = await import("../terminalInstances");
    mod.destroyTerminal("test-session");
    mod.__setWebSocketCtorForTests(null);
  });

  it("opens exactly one websocket on acquire", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");
    expect(createdSockets).toHaveLength(1);
    expect(createdSockets[0].url).toMatch(/\/ws\/terminal\/test-session$/);
  });

  it("reopen() tears down the previous ws and opens a fresh one", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    expect(createdSockets).toHaveLength(1);
    const first = createdSockets[0];

    inst.reopen();

    expect(first.close).toHaveBeenCalled();
    expect(createdSockets).toHaveLength(2);
    // inst.ws now points to the new socket, not the old one.
    expect(inst.ws).toBe(createdSockets[1]);
    expect(inst.ws).not.toBe(first);
  });

  it("reopen() notifies onWsChange subscribers with the new ws", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    const seen: WebSocket[] = [];
    const unsubscribe = inst.onWsChange((next) => seen.push(next));

    inst.reopen();
    inst.reopen();

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(inst.ws);

    unsubscribe();
    inst.reopen();
    // Unsubscribed listener should not receive further updates.
    expect(seen).toHaveLength(2);
  });

  it("reopen() disposes the previous onData handler and re-registers against the new ws", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    // `terminal.onData` is the vi.fn spy from the FakeTerminal mock above.
    // Each call returns a fresh { dispose: vi.fn() } object.
    const onData = inst.terminal.onData as unknown as ReturnType<typeof vi.fn>;
    expect(onData).toHaveBeenCalledTimes(1);
    const firstDisposable = onData.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };

    inst.reopen();

    // First disposable must have been disposed exactly once.
    expect(firstDisposable.dispose).toHaveBeenCalledTimes(1);
    // onData must have been re-registered for the new ws.
    expect(onData).toHaveBeenCalledTimes(2);
  });

  it("destroyTerminal disposes the active onData handler", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    const onData = inst.terminal.onData as unknown as ReturnType<typeof vi.fn>;
    expect(onData).toHaveBeenCalledTimes(1);
    const disposable = onData.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };

    mod.destroyTerminal("test-session");

    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  // --- connection state ---------------------------------------------------
  // getConnectionState / onConnectionChange expose the "is this browser's
  // socket for the session alive?" fact that the disconnected badge renders.
  // Deliberately separate from onWsChange, which only reports ws identity
  // swaps and cannot observe a socket dying.

  /** Simulate the browser delivering a close event on a fake socket. */
  function closeSocket(ws: FakeWs): void {
    ws.readyState = 3; // CLOSED
    ws.onclose?.(new Event("close") as CloseEvent);
  }

  it("reports unattached for a session with no instance", async () => {
    const mod = await import("../terminalInstances");
    // Never acquired in this browser: normal, frequent, and not a fault.
    expect(mod.getConnectionState("never-acquired-session")).toBe("unattached");
  });

  it("reports connected while the socket is open", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    expect(createdSockets[0].readyState).toBe(1); // OPEN
    expect(mod.getConnectionState("test-session")).toBe("connected");
  });

  it("reports disconnected and notifies subscribers when the socket closes", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    const seen: string[] = [];
    mod.onConnectionChange("test-session", (state) => seen.push(state));

    closeSocket(createdSockets[0]);

    expect(mod.getConnectionState("test-session")).toBe("disconnected");
    expect(seen).toEqual(["disconnected"]);
  });

  it("notifies subscribers again when reopen establishes a new socket", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    const seen: string[] = [];
    mod.onConnectionChange("test-session", (state) => seen.push(state));

    closeSocket(createdSockets[0]);
    expect(seen).toEqual(["disconnected"]);

    seen.length = 0;
    inst.reopen();
    // The fresh socket announces itself the way a browser does.
    createdSockets[1].onopen?.(new Event("open"));

    expect(seen).toContain("connected");
    expect(mod.getConnectionState("test-session")).toBe("connected");
  });

  it("keeps notifying remaining subscribers when one throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    const boom = vi.fn(() => {
      throw new Error("listener boom");
    });
    const seen: string[] = [];
    mod.onConnectionChange("test-session", boom);
    mod.onConnectionChange("test-session", (state) => seen.push(state));

    closeSocket(createdSockets[0]);

    expect(boom).toHaveBeenCalled();
    expect(seen).toEqual(["disconnected"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops notifying after unsubscribe", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    const seen: string[] = [];
    const unsubscribe = mod.onConnectionChange("test-session", (state) =>
      seen.push(state),
    );
    unsubscribe();

    closeSocket(createdSockets[0]);

    expect(seen).toEqual([]);
    // ...while the state itself is still observable by a direct read.
    expect(mod.getConnectionState("test-session")).toBe("disconnected");
  });
});

describe("followBottomAcrossResize", () => {
  // A minimal terminal-like stub whose `fit` callback can mutate baseY to
  // simulate the scrollback growth a real resize causes.
  function makeTerm(viewportY: number, baseY: number) {
    const term = {
      buffer: { active: { viewportY, baseY } },
      scrollToBottom: vi.fn(),
    };
    return term;
  }

  it("always calls fit", async () => {
    const { followBottomAcrossResize } = await import("../terminalInstances");
    const term = makeTerm(10, 10);
    const fit = vi.fn();
    followBottomAcrossResize(term, fit);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("scrolls to bottom when the user was at the bottom before fit", async () => {
    const { followBottomAcrossResize } = await import("../terminalInstances");
    const term = makeTerm(10, 10); // viewportY === baseY → at bottom
    followBottomAcrossResize(term, vi.fn());
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("does NOT scroll when the user had scrolled up before fit", async () => {
    const { followBottomAcrossResize } = await import("../terminalInstances");
    const term = makeTerm(3, 10); // viewportY < baseY → scrolled up
    followBottomAcrossResize(term, vi.fn());
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it("scrolls to bottom even when fit shifts baseY past viewportY (regression: capture before fit)", async () => {
    const { followBottomAcrossResize } = await import("../terminalInstances");
    const term = makeTerm(10, 10); // at bottom before fit
    // Simulate a shrink-on-reattach: rows decrease, scrollback grows, so
    // baseY jumps ahead of the (unchanged) viewportY. The OLD code read
    // atBottom AFTER this and wrongly skipped the scroll.
    const fit = vi.fn(() => {
      term.buffer.active.baseY = 40;
    });
    followBottomAcrossResize(term, fit);
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});

describe("shiftEnterHandler", () => {
  it("sends backslash+CR to PTY and returns false on Shift+Enter keydown", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send);

    const result = handler({ type: "keydown", key: "Enter", shiftKey: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("\\\r");
    expect(result).toBe(false);
  });

  it("returns true and does not send on plain Enter keydown", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send);

    const result = handler({ type: "keydown", key: "Enter", shiftKey: false });

    expect(send).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("returns true on Shift+Enter keyup (only fires on keydown)", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send);

    const result = handler({ type: "keyup", key: "Enter", shiftKey: true });

    expect(send).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("returns true on Shift+A keydown (non-Enter key)", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send);

    const result = handler({ type: "keydown", key: "A", shiftKey: true });

    expect(send).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  // The copy is xterm's own `copy` DOM listener, which this helper never
  // touches — all it must do is claim the keydown (return false, so xterm
  // does not also emit \x03) without suppressing it (no preventDefault /
  // stopPropagation, so the browser still fires `copy`). Those three
  // assertions are the whole contract that keeps copy-on-selection working;
  // asserting on the clipboard itself would be testing xterm, not us.
  it("Ctrl+C with a selection: claims the keydown without suppressing its default", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const handler = shiftEnterHandler(send, () => true);

    const result = handler({
      type: "keydown",
      key: "c",
      shiftKey: false,
      ctrlKey: true,
      preventDefault,
      stopPropagation,
    });

    expect(send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("Ctrl+C with no selection: sends interrupt (cancel fallback)", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send, () => false);

    const result = handler({ type: "keydown", key: "c", shiftKey: false, ctrlKey: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("\x03");
    expect(result).toBe(false);
  });

  it("Ctrl+Shift+C: always sends interrupt and prevents default, even with a selection", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const handler = shiftEnterHandler(send, () => true);

    const result = handler({
      type: "keydown",
      key: "C",
      shiftKey: true,
      ctrlKey: true,
      preventDefault,
      stopPropagation,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("\x03");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("plain 'c' with no ctrl: does not intercept", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send, () => true);

    const result = handler({ type: "keydown", key: "c", shiftKey: false, ctrlKey: false });

    expect(send).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
