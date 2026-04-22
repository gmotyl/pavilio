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
});

describe("shiftEnterHandler", () => {
  it("sends ESC+CR to PTY and returns false on Shift+Enter keydown", async () => {
    const { shiftEnterHandler } = await import("../terminalInstances");
    const send = vi.fn();
    const handler = shiftEnterHandler(send);

    const result = handler({ type: "keydown", key: "Enter", shiftKey: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("\x1b\r");
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
});
