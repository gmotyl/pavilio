/**
 * The pane's waiting state: what the body shows between the moment a draft is
 * sent and the moment the reply — or the silence that stands for one — comes
 * back.
 *
 * Everything is asserted through `AnswerPane` and, where the criterion is about
 * the transport, through a `SpeechControlBar` mounted beside it: the two are
 * siblings in `TerminalView`'s speech surface, the press happens on the bar and
 * the consequence shows in the pane, so a harness holding only one of them
 * could not see the criterion at all.
 *
 * ## Why the speech host is a proxy
 *
 * "Entering the waiting state touches nothing on the speech host" is a negative
 * claim, and a negative claim asserted as a list of methods only ever covers
 * the methods whoever wrote the list thought of. So the host here is wrapped:
 * while it is armed, reading ANY member that is not one of the render-time
 * readers throws. A future `speech.onWhatever` that the waiting path calls
 * fails this test without anybody remembering to add it.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { type UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { SpeechControlBar } from "../SpeechControlBar";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

// The activity channel opens a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. jsdom would really try to dial
// `ws://localhost/ws/terminal-activity`, fail, and leave that timer in the
// file — which is precisely the pollution the "no timer" test is about. A
// socket that never closes keeps the module honest and the timer table empty.
vi.hoisted(() => {
  class QuietSocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: no test here draws a segment.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// mermaid's rendering stack is browser-only and no answer here holds a fence.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

const SESSION = "cell-a";

const ANSWER =
  "The first answer explains why the migration has to finish before any traffic is switched over.";
const NEXT_ANSWER =
  "The second answer arrives while the pane is still waiting, and is what the reader asked for.";

/**
 * The members the pane and the bar read while they render. Everything else on
 * the host is a command — something that enqueues, plays, stops, seeks or arms
 * — and the waiting state must reach none of them.
 */
const READERS = new Set([
  "stateFor",
  "queueFor",
  "unitsFor",
  "subscribeProgress",
  "progressFor",
  "unitDurationsFor",
  "armedSessionId",
]);

const utterance = (id: string, text: string): Utterance => ({
  id,
  sessionId: SESSION,
  text,
  at: 1,
});

const queueOf = (u: Utterance): UtteranceQueue => ({
  previous: null,
  current: u,
  pending: [],
  cursor: "current",
});

function makeSpeech(queueFor: () => UtteranceQueue): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor,
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
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

/**
 * The same host, wrapped so that — once armed — reading any member outside
 * {@link READERS} throws. See the note at the top of the file.
 */
function armable(host: GridSpeech) {
  let armed = false;
  const speech = new Proxy(host, {
    get(target, property, receiver) {
      if (armed && typeof property === "string" && !READERS.has(property)) {
        throw new Error(`entering the waiting state reached speech.${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as GridSpeech;
  return {
    speech,
    arm: (): void => {
      armed = true;
    },
  };
}

/** Every command on a host, found by shape rather than by a list kept by hand. */
const commandsOf = (host: GridSpeech): Mock[] =>
  (Object.keys(host) as (keyof GridSpeech)[])
    .filter((key) => typeof host[key] === "function" && !READERS.has(key))
    .map((key) => host[key] as unknown as Mock);

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The composer's grip asks jsdom whether this is a touch viewport. */
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

const send = vi.fn();

/** The pane alone — every criterion but the transport one. */
const paneTree = (speech: GridSpeech) => (
  <MemoryRouter>
    <AnswerPane
      sessionId={SESSION}
      speech={speech}
      onClose={() => {}}
      send={send}
      autoOpen={false}
      onAutoOpenChange={() => {}}
    />
  </MemoryRouter>
);

/** The speech surface as the cell has it: the row, then the pane under it. */
const surfaceTree = (speech: GridSpeech) => (
  <MemoryRouter>
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen
      onToggleAnswer={() => {}}
      send={send}
    />
    <AnswerPane
      sessionId={SESSION}
      speech={speech}
      onClose={() => {}}
      send={send}
      autoOpen={false}
      onAutoOpenChange={() => {}}
    />
  </MemoryRouter>
);

const body = (): HTMLElement => screen.getByTestId(`answer-pane-body-${SESSION}`);

const waiting = (): HTMLElement | null => screen.queryByTestId(`answer-pane-waiting-${SESSION}`);

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

const playButton = (): HTMLElement => screen.getByTestId(`speech-bar-playpause-${SESSION}`);

/**
 * An activity broadcast landing while the panel is mounted. Wrapped in `act`
 * because it is the realtime channel's own listener that reaches React here —
 * the waiting store subscribes to the channel, not to anything a render did.
 */
const activity = (state: "idle" | "busy" | "attention", at: number): void => {
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
};

/** Type a reply and press Enter — the one gesture that starts a wait. */
function sendReply(text = "ship it"): void {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

beforeEach(() => {
  send.mockClear();
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useRealTimers();
});

describe("the answer pane while a reply is pending", () => {
  it("shows the waiting state after a send", () => {
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();

    sendReply();

    // The draft reached the PTY, and the body stopped showing the answer that
    // is now the question's predecessor rather than its reply.
    expect(send).toHaveBeenCalledWith("ship it\r");
    expect(waiting()).toBeInTheDocument();
    expect(within(body()).queryByText(ANSWER)).toBeNull();
  });

  it("touches nothing on the speech host when it starts waiting", () => {
    const host = makeSpeech(() => queueOf(utterance("u-1", ANSWER)));
    const { speech, arm } = armable(host);
    render(paneTree(speech));

    arm();
    sendReply();

    // It got there — otherwise the rest of this test would pass on a pane that
    // never entered the state at all.
    expect(waiting()).toBeInTheDocument();
    const commands = commandsOf(host);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command).not.toHaveBeenCalled();
  });

  it("renders the new answer when one arrives", () => {
    let queue = queueOf(utterance("u-1", ANSWER));
    const speech = makeSpeech(() => queue);
    const { rerender } = render(paneTree(speech));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    queue = queueOf(utterance("u-2", NEXT_ANSWER));
    rerender(paneTree(speech));

    expect(waiting()).toBeNull();
    expect(within(body()).getByText(NEXT_ANSWER)).toBeInTheDocument();
  });

  it("returns to the answer when the transport is used, keeping a pending mark", () => {
    render(surfaceTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    fireEvent.click(playButton());

    // The text is legible again, and the play button still says a reply is on
    // its way — the wait shrank, it did not end.
    expect(waiting()).toBeNull();
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();
    expect(playButton()).toHaveAttribute("data-pending", "1");
  });

  it("returns to the answer when the session goes idle having spoken nothing", () => {
    _applyEventForTests({ sessionId: SESSION, state: "busy", at: 1 });
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    // Still working: the wait is not over because an event arrived.
    activity("busy", 2);
    expect(waiting()).toBeInTheDocument();

    activity("idle", 3);

    expect(waiting()).toBeNull();
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();
  });

  it("does not schedule a timeout to leave the waiting state", () => {
    vi.useFakeTimers();
    _applyEventForTests({ sessionId: SESSION, state: "busy", at: 1 });
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    sendReply();
    expect(waiting()).toBeInTheDocument();

    // Nothing was armed on the way in...
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();

    // ...and ten minutes of clock changes nothing: the session is still busy,
    // so the only thing that could end this wait has not happened.
    // Inside `act`, deliberately: a timer that fired here would settle the
    // store, and only a flush turns that into the DOM the next line reads. An
    // unwrapped advance would leave the stale element in place and this half of
    // the test would pass over an implementation that does use a timeout
    // (verified: it did, before the wrap).
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(waiting()).toBeInTheDocument();
    expect(within(body()).queryByText(ANSWER)).toBeNull();
  });
});
