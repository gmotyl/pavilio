import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub out xterm + its addons before importing the module under test. jsdom
// does not implement the terminal surface xterm expects (ResizeObserver,
// canvas measurements, etc.) and we only care about ws lifecycle here.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    // Enough of xterm's buffer surface for viewportLooksBlank(), which the
    // metric builder reads to stamp `blankAtClick`. Every line is absent, so
    // this fake viewport reads as blank.
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: (_index: number) =>
          undefined as
            | { translateToString: (trim?: boolean) => string }
            | undefined,
      },
    };
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

/** Every reconnect-log POST the module made, newest last. */
interface LoggedMetric {
  sessionId?: string;
  blankAtClick?: boolean;
  wsReadyState?: number;
  pingMs?: number;
  frameMs?: number;
  cols?: number;
  rows?: number;
  stale?: boolean;
  trigger?: string;
}

describe("terminalInstances", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Bodies of the reconnect-log POSTs, in order. */
  function loggedMetrics(): LoggedMetric[] {
    return fetchMock.mock.calls
      .filter(([url]) => url === "/api/terminal/reconnect-log")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
  }

  beforeEach(async () => {
    createdSockets.length = 0;
    // The reconnect log is fire-and-forget over fetch. Stub it for EVERY test
    // in this file, not just the logging ones: jsdom has no server behind the
    // relative URL, so a real call would reject on an unrelated test's close.
    fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
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
    vi.unstubAllGlobals();
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

  it("reports disconnected when the socket errors", async () => {
    // AC3 is "closes OR errors". The error path deliberately does NOT re-read
    // readyState: a browser can deliver `error` while the socket is still OPEN
    // and never follow it with an observable close, so the error itself is the
    // disconnect signal. Firing it at readyState === 1 pins that down — a
    // "just derive the state from readyState" refactor would fail here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    const seen: string[] = [];
    mod.onConnectionChange("test-session", (state) => seen.push(state));

    const ws = createdSockets[0];
    expect(ws.readyState).toBe(1); // OPEN — the whole point of this test
    ws.onerror?.(new Event("error"));

    expect(ws.readyState).toBe(1); // still OPEN after the error
    expect(seen).toEqual(["disconnected"]);
    expect(mod.getConnectionState("test-session")).toBe("disconnected");
    warn.mockRestore();
  });

  it("reports connected at the moment of the first ws swap", async () => {
    // On FIRST attach the optimistic "connected" emit fires at the `inst.ws`
    // identity swap inside connectWs. The instance must already be pooled by
    // then, otherwise getConnectionState() says "unattached" at the very
    // instant the listener is told "connected" — and a useSyncExternalStore
    // consumer re-reads the snapshot, sees no change, and drops the emit.
    const mod = await import("../terminalInstances");

    const seen: string[] = [];
    const readInsideListener: string[] = [];
    mod.onConnectionChange("test-session", (state) => {
      seen.push(state);
      readInsideListener.push(mod.getConnectionState("test-session"));
    });

    mod.acquireTerminal("test-session");

    expect(seen).toEqual(["connected"]);
    expect(readInsideListener).toEqual(["connected"]);
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
    // The ws identity swap inside connectWs reports "connected" optimistically,
    // before the handshake completes — so exactly one emit lands here.
    expect(seen).toEqual(["connected"]);

    // The fresh socket announces itself the way a browser does. This is the
    // SECOND "connected" emit, and it is intentional: asserting the exact
    // sequence (rather than `toContain`) is what makes the ws.onopen emit
    // load-bearing, and documents that the pair must not be deduped.
    createdSockets[1].onopen?.(new Event("open"));

    expect(seen).toEqual(["connected", "connected"]);
    expect(mod.getConnectionState("test-session")).toBe("connected");
  });

  it("notifies unattached when the terminal is destroyed", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    const seen: string[] = [];
    const readInsideListener: string[] = [];
    mod.onConnectionChange("test-session", (state) => {
      seen.push(state);
      readInsideListener.push(mod.getConnectionState("test-session"));
    });

    mod.destroyTerminal("test-session");

    // A destroyed session is "no socket, no fault" — never a disconnect
    // flicker on the way out.
    expect(seen).toEqual(["unattached"]);
    // The instance is dropped from the pool BEFORE the emit, so a listener
    // reading the state synchronously already agrees with what it was told.
    expect(readInsideListener).toEqual(["unattached"]);
    expect(mod.getConnectionState("test-session")).toBe("unattached");

    // Destroying an already-destroyed session is a no-op, not a re-emit.
    mod.destroyTerminal("test-session");
    expect(seen).toEqual(["unattached"]);

    // A subscriber outlives the instance: re-acquiring the same session must
    // reach the same, still-subscribed listener.
    mod.acquireTerminal("test-session");
    expect(seen).toEqual(["unattached", "connected"]);
    expect(mod.getConnectionState("test-session")).toBe("connected");
  });

  it("reports hasExited after the process exits", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    expect(mod.hasExited("test-session")).toBe(false);

    const seen: string[] = [];
    mod.onConnectionChange("test-session", (state) => seen.push(state));

    createdSockets[0].onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0 }),
    } as MessageEvent);

    expect(mod.hasExited("test-session")).toBe(true);
    // A clean exit is NOT a connection fault: the socket is still open, so the
    // state stays "connected" until the server actually closes it. That gap is
    // how a normally-exited shell is told apart from a dead socket.
    expect(seen).toEqual([]);
    expect(mod.getConnectionState("test-session")).toBe("connected");

    // No pooled instance → nothing has exited.
    expect(mod.hasExited("never-acquired-session")).toBe(false);
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

  // --- reconnect log ------------------------------------------------------
  // The log used to record only clicks, which says what the user did and
  // nothing about what happened when they did nothing. These cases pin the
  // two automatic triggers, and the shape they must keep sharing with the
  // manual line so old and new records stay directly comparable.

  /** Field names of the metric, frozen: renaming one orphans the old lines. */
  const METRIC_KEYS = [
    "blankAtClick",
    "cols",
    "frameMs",
    "pingMs",
    "rows",
    "sessionId",
    "stale",
    "trigger",
    "wsReadyState",
  ];

  it("appends a disconnect line when the socket closes", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");
    // The attach itself must not log — only the death of a live socket does.
    expect(loggedMetrics()).toEqual([]);

    closeSocket(createdSockets[0]);

    const logged = loggedMetrics();
    expect(logged).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/terminal/reconnect-log");
    expect((init as RequestInit).method).toBe("POST");
    // The terminal's state AT THE MOMENT OF THE CLOSE, in the same fields the
    // manual line has always used.
    expect(Object.keys(logged[0]).sort()).toEqual(METRIC_KEYS);
    expect(logged[0].trigger).toBe("disconnect");
    expect(logged[0].sessionId).toBe("test-session");
    expect(logged[0].wsReadyState).toBe(3); // CLOSED
    expect(logged[0].blankAtClick).toBe(true);
    expect(logged[0].cols).toBe(80);
    expect(logged[0].rows).toBe(24);
    expect(typeof logged[0].pingMs).toBe("number");
    expect(typeof logged[0].frameMs).toBe("number");
    expect(logged[0].stale).toBe(false);
  });

  it("logs a second disconnect after a reopen", async () => {
    // The dedupe is transition-based, not "one line per socket ever": a
    // session that is repaired and dies again is two deaths and must be two
    // rows. Without this, a dedupe that simply went quiet after the first
    // close would look identical to the correct one.
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    closeSocket(createdSockets[0]);
    expect(loggedMetrics()).toHaveLength(1);

    // Repaired: reopen() swaps in a live socket and moves the state back.
    inst.reopen();
    expect(mod.getConnectionState("test-session")).toBe("connected");

    closeSocket(createdSockets[1]);

    const logged = loggedMetrics();
    expect(logged.map((m) => m.trigger)).toEqual(["disconnect", "disconnect"]);
  });

  it("stamps wsReadyState even when the instance holds no socket", async () => {
    // `undefined` would be dropped by JSON.stringify, silently shrinking the
    // frozen field set; the sentinel keeps every line the same shape.
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");
    // The only state in which the pool has an instance but no socket. Written
    // directly because no public path parks an instance there for long enough
    // to log from — reopen() fills the field back in on the next line.
    (inst as { ws: WebSocket | null }).ws = null;

    mod.reconnectSession("test-session");

    const logged = loggedMetrics();
    expect(logged).toHaveLength(1);
    expect(Object.keys(logged[0]).sort()).toEqual(METRIC_KEYS);
    expect(logged[0].wsReadyState).toBe(-1);
  });

  it("logs a ws error as a single disconnect line, not one per event", async () => {
    // A browser can deliver `error` and then `close` for one socket death.
    // The line is emitted on the transition INTO disconnected, so the second
    // event adds nothing — one death, one row.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    createdSockets[0].onerror?.(new Event("error"));
    closeSocket(createdSockets[0]);

    const logged = loggedMetrics();
    expect(logged).toHaveLength(1);
    expect(logged[0].trigger).toBe("disconnect");
    warn.mockRestore();
  });

  it("does not log a disconnect for a cleanly exited session", async () => {
    // `[Process exited]` is already on screen: the socket closing afterwards
    // is the server tidying up, not a terminal that died under the user. A row
    // for it would pollute exactly the dataset this log exists to build.
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    createdSockets[0].onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0 }),
    } as MessageEvent);
    closeSocket(createdSockets[0]);

    expect(loggedMetrics()).toEqual([]);
    // The connection state still moves — only the log line is withheld.
    expect(mod.getConnectionState("test-session")).toBe("disconnected");
  });

  it("does not log a disconnect for the socket a manual reconnect tears down", async () => {
    // reopen() detaches onclose BEFORE close(), so the close of the socket the
    // client itself killed is unobservable. Without that, every manual
    // reconnect would emit a spurious `disconnect` alongside its `manual`.
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    mod.reconnectSession("test-session");
    // Whatever the fake socket does on close, the detached handler is silent.
    createdSockets[0].onclose?.(new Event("close") as CloseEvent);

    const logged = loggedMetrics();
    expect(logged.map((m) => m.trigger)).toEqual(["manual"]);
  });

  it("keeps the manual line's shape unchanged", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("test-session");

    mod.reconnectSession("test-session");

    const logged = loggedMetrics();
    expect(logged).toHaveLength(1);
    expect(Object.keys(logged[0]).sort()).toEqual(METRIC_KEYS);
    expect(logged[0].trigger).toBe("manual");
    expect(logged[0].wsReadyState).toBe(1); // still OPEN at click time
  });

  it("appends an auto-blank line when a blank-gated reopen fires", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");

    // What useMobileReconnect does on its two blank-gated paths: report the
    // reopen it is about to perform, identified by the socket it holds.
    mod.reportAutoBlankReopen(inst.ws);

    const logged = loggedMetrics();
    expect(logged).toHaveLength(1);
    expect(Object.keys(logged[0]).sort()).toEqual(METRIC_KEYS);
    expect(logged[0].trigger).toBe("auto-blank");
    expect(logged[0].sessionId).toBe("test-session");
    expect(logged[0].blankAtClick).toBe(true);

    // A socket that belongs to no pooled instance (and no socket at all) is a
    // no-op, never a line attributed to the wrong session.
    mod.reportAutoBlankReopen(null);
    mod.reportAutoBlankReopen({ readyState: 1 } as unknown as WebSocket);
    expect(loggedMetrics()).toHaveLength(1);
  });

  it("a failing log request does not block the reconnect", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("test-session");
    expect(createdSockets).toHaveLength(1);

    // Both shapes of failure: a synchronous throw and a rejected promise.
    fetchMock.mockImplementationOnce(() => {
      throw new Error("fetch exploded");
    });
    mod.reconnectSession("test-session");
    expect(createdSockets).toHaveLength(2);
    expect(inst.ws).toBe(createdSockets[1]);

    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    mod.reconnectSession("test-session");
    expect(createdSockets).toHaveLength(3);

    // ...and a failing log must not block the close path either.
    fetchMock.mockImplementationOnce(() => {
      throw new Error("fetch exploded");
    });
    closeSocket(createdSockets[2]);
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
