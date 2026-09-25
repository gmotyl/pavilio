/**
 * The caret landing in the answer composer repairs that cell's socket.
 *
 * Putting the caret here is the user saying *I am about to send something*, so
 * it is the moment to reconnect — not the Enter that follows it. A reconnect
 * started while the reply is still being typed has the whole draft's worth of
 * time to finish, so the send finds a live socket and the refusal path the
 * composer keeps for it is never reached.
 *
 * ## Why the REAL `terminalInstances` is wired up here
 *
 * Three of the six cases are about what `reconnectOnActivate` REFUSES to do —
 * a healthy socket, an exited session, a second focus during the handshake —
 * and a stubbed `reconnectOnActivate` would answer all three by construction:
 * the test would assert that the mock the test itself wrote did nothing. So
 * this file mounts the pane over the real pool, with xterm and the websocket
 * faked exactly as `terminalInstances.test.ts` fakes them, and reads the
 * verdict off the sockets that were actually opened and the reconnect-log
 * lines that were actually posted.
 *
 * ## Why the auto-open case is a regression guard, not a formality
 *
 * The whole safety argument for this trigger is that the composer has NO
 * autofocus, so a focus event is always a real user action. If the field ever
 * took focus when the pane auto-opened on an arriving answer, the trigger
 * would fire on an ANSWER LANDING — which is precisely the "a dead socket is
 * never reopened unasked" rule the living terminal requires (ADR 0010). So
 * that case asserts the ABSENCE of focus on mount as well as the absence of a
 * reconnect: add `autoFocus` to the textarea and it fails on both counts.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

// jsdom has none of the surface xterm measures itself against, and this file
// cares only about the ws lifecycle behind the pool — the same stubs
// `terminalInstances.test.ts` installs, for the same reason.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: (_index: number) =>
          undefined as { translateToString: (trim?: boolean) => string } | undefined,
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
    onData = vi.fn((_cb: (data: string) => void) => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// The synthesis cache the pane's rail peeks into. Nothing is warm and nothing
// subscribes: no unit is ever drawn here.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// The auto-open case puts a real answer under the cursor, which mounts the
// markdown renderer — and that reaches mermaid's browser-only stack.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/**
 * The LED the composer's focus has always dismissed.
 *
 * Stubbed at the CHANNEL rather than at `attentionArrival`, so the dismissal
 * runs its real path: the rule reads the state through here and writes the
 * frame through the pool, and the last case asserts that frame on the socket.
 */
const activity = vi.hoisted(() => ({ state: "idle" as "idle" | "busy" | "attention" }));
vi.mock("../useTerminalActivityChannel", () => ({
  getActivityState: () => activity.state,
  useActivityState: () => activity.state,
  // The waiting row watches the cell through this; nothing here changes state
  // mid-test, so the subscription is a no-op that unsubscribes cleanly.
  subscribeActivity: () => () => {},
}));

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

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no `matchMedia`, and the composer's grip hook asks it. */
function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(queue: UtteranceQueue = emptyUtteranceQueue): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor: () => queue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

/** One answer under the cursor — what the pane auto-opens ON. */
function speechWith(sessionId: string, text: string): GridSpeech {
  return makeSpeech({
    previous: [],
    current: { id: text, sessionId, text, at: 1 },
    pending: [],
    cursor: 0,
  });
}

const PROJECT = "alpha";

function session(id: string): SessionMeta {
  return {
    id,
    name: id,
    project: PROJECT,
    cwd: `/srv/git/${PROJECT}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const SESSIONS = ["cell-a", "cell-b"];

let fetchMock: ReturnType<typeof vi.fn>;

/** Bodies of the reconnect-log POSTs, in order — the trigger is what we read. */
function loggedTriggers(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/terminal/reconnect-log")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).trigger as string);
}

/** A socket that died without the session exiting — the repairable state. */
function killSocket(ws: FakeWs): void {
  ws.readyState = 3;
  ws.onclose?.(new Event("close") as CloseEvent);
}

/** The PTY said the process is gone — the state no focus may revive. */
function reportExit(ws: FakeWs): void {
  ws.onmessage?.({ data: JSON.stringify({ type: "exit", code: 0 }) } as MessageEvent);
}

const field = (sessionId = "cell-a"): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${sessionId}`) as HTMLTextAreaElement;

function renderPane(sessionId: string, speech: GridSpeech = makeSpeech(), autoOpen = false) {
  return render(
    // The router is for the markdown renderer, which links with `useNavigate`.
    <MemoryRouter>
      <AnswerPane
        sessionId={sessionId}
        speech={speech}
        onClose={() => {}}
        send={() => true}
        autoOpen={autoOpen}
        onAutoOpenChange={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  createdSockets.length = 0;
  activity.state = "idle";
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
  // One stub for both fetches this file makes: the tab's session load, and the
  // pool's fire-and-forget reconnect log. jsdom has no server behind either.
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(SESSIONS.map(session)),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  await refreshSessions();
  const mod = await import("../terminalInstances");
  mod.__setWebSocketCtorForTests(FakeWebSocket as unknown as new (url: string) => WebSocket);
});

afterEach(async () => {
  // Instances are keyed by sessionId at module scope, so a cell left in the
  // pool would hand the next test a socket it did not open.
  const mod = await import("../terminalInstances");
  for (const id of SESSIONS) mod.destroyTerminal(id);
  mod.__setWebSocketCtorForTests(null);
  vi.unstubAllGlobals();
});

describe("AnswerComposer focus repairs the socket", () => {
  it("focusing the composer reconnects a disconnected session", async () => {
    const mod = await import("../terminalInstances");
    // Two broken cells, so "reconnects" can be told apart from "reconnects
    // THIS one" — a repair aimed at the pool would pass with one.
    mod.acquireTerminal("cell-a");
    mod.acquireTerminal("cell-b");
    killSocket(createdSockets[0]);
    killSocket(createdSockets[1]);
    renderPane("cell-a");

    field().focus();

    expect(createdSockets).toHaveLength(3);
    expect(createdSockets[2].url).toMatch(/\/ws\/terminal\/cell-a$/);
    expect(mod.getConnectionState("cell-a")).toBe("connected");
    expect(mod.getConnectionState("cell-b")).toBe("disconnected");
    expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual(["auto-activate"]);
  });

  it("focusing a healthy session reconnects nothing", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("cell-a");
    renderPane("cell-a");

    field().focus();

    // A live socket has nothing to repair, and tearing it down to prove a
    // point would lose the buffer the user is reading.
    expect(createdSockets).toHaveLength(1);
    expect(loggedTriggers()).toEqual([]);
  });

  it("focusing an exited session reconnects nothing", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("cell-a");
    // The terminal already prints [Process exited]; reopening replays it.
    reportExit(createdSockets[0]);
    killSocket(createdSockets[0]);
    renderPane("cell-a");

    field().focus();

    expect(createdSockets).toHaveLength(1);
    expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual([]);
  });

  it("refocusing does not start a second reconnect", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("cell-a");
    killSocket(createdSockets[0]);
    renderPane("cell-a");

    // The caret leaves the field and comes back — routine while a reply is
    // written, and the handshake is still in flight both times.
    field().focus();
    field().blur();
    field().focus();

    expect(createdSockets).toHaveLength(2);
    expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual(["auto-activate"]);
  });

  it("the composer has no autofocus, so auto-open reconnects nothing", async () => {
    const mod = await import("../terminalInstances");
    mod.acquireTerminal("cell-a");
    killSocket(createdSockets[0]);

    // Every focus that lands anywhere in the tree while the pane opens.
    // `document.activeElement` alone would NOT catch an `autoFocus` here: the
    // pane's root takes the caret back on mount for its own Escape handling,
    // so the field can have been focused — and the reconnect fired — with the
    // root reading as the active element a tick later. The EVENT is the fact
    // this guard is about.
    const focused: (string | null)[] = [];
    const record = (e: Event) => {
      const target = e.target as HTMLElement | null;
      focused.push(target?.getAttribute?.("data-testid") ?? target?.tagName ?? null);
    };
    document.addEventListener("focusin", record);
    try {
      // The pane as it opens ON an arriving answer: an utterance under the
      // cursor, and the cell's auto-open switch on.
      renderPane("cell-a", speechWith("cell-a", "the answer that opened the pane"), true);
    } finally {
      document.removeEventListener("focusin", record);
    }

    // The field is mounted and empty-handed: nothing gave it the caret.
    expect(field()).toBeInTheDocument();
    expect(focused).not.toContain("answer-pane-composer-cell-a");
    expect(document.activeElement).not.toBe(field());
    // And so the repair never ran — a dead socket stays dead until asked.
    expect(createdSockets).toHaveLength(1);
    expect(mod.getConnectionState("cell-a")).toBe("disconnected");
    expect(loggedTriggers().filter((t) => t === "auto-activate")).toEqual([]);
  });

  it("focus still dismisses the attention LED", async () => {
    const mod = await import("../terminalInstances");
    const inst = mod.acquireTerminal("cell-a");
    activity.state = "attention";
    renderPane("cell-a");
    const socket = createdSockets[0];
    socket.send.mockClear();

    field().focus();

    // The arrival rule the composer's focus has always run, unchanged by the
    // repair now sharing the handler.
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "dismiss-attention" }));
    expect(inst.sessionId).toBe("cell-a");
  });
});
