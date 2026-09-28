/**
 * Who SPENDS the retry ticket, and who must not.
 *
 * `answerRetry.test.ts` proves the store's own arithmetic and
 * `AnswerComposer.retryEnter.test.tsx` proves the composer opens, shows and
 * consumes a ticket. Neither of them can see the fact this file exists for:
 * the three call sites that end a ticket are in three different modules, they
 * are reached from three different lifetimes, and each one is wrong in a way
 * the others cannot catch.
 *
 * - the PANE records which utterance the send was a reply to. It has to be the
 *   pane, because the composer below it does not know what the body was
 *   showing when the draft went out — see `AnswerPane.onSubmitted`.
 * - the BAR notices the reply landing. It has to be the bar, because
 *   `TerminalView` mounts the pane only inside the row's own condition: close
 *   the eye and the pane is gone while the row stays, and an arrival the pane
 *   alone watched for would be missed for as long as it stayed closed.
 * - `destroyTerminal` ends the session, and everything keyed by its id with it.
 *
 * ## Why the real store, the real clock and mounted components
 *
 * Every criterion here is an ORDERING between a React lifetime and a
 * module-level map: an effect that runs on mount, a callback that runs when a
 * socket accepts a write, a teardown that runs from the pool. Spying on the
 * store would assert that a function was called and say nothing about whether
 * the offer the user is looking at survived — which is the whole question. So
 * the store is real, the submits go through the real `ptySubmit`, and the
 * assertions read `isRetryOffered` or the composer's own button.
 *
 * ## Why the bar and the pane are two roots
 *
 * They are siblings in `TerminalView`, and the criteria are about one of them
 * remounting or disappearing while the other stays. Rendering them into
 * separate containers is what makes "the bar remounted" and "the pane closed"
 * separately expressible at all; a single tree could only unmount both.
 */
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes — which under fake timers would
// put a timer of its own into the table the retry deadline is advanced
// through. A socket that never closes keeps the table to this file's timers.
vi.hoisted(() => {
  class QuietSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
  // The pane measures its own rail, and jsdom has no observer to measure it
  // with. Assigned rather than stubbed because the pane's effect can run on a
  // teardown flush, after a per-test stub would already have been lifted.
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
  // The reconnect log is fire-and-forget over `fetch`, and jsdom has no server
  // behind its relative URL.
  (globalThis as unknown as { fetch: unknown }).fetch = () =>
    Promise.resolve({ ok: true } as unknown as Response);
});

// `terminalInstances` is a SUBJECT here, not a stub — the destroy criterion is
// about what that function does — so xterm has to be survivable instead. jsdom
// implements none of the terminal surface it expects, and this file never
// looks at a viewport.
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

vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// The synthesis cache the rail and the scrubber peek into. Nothing is warm and
// nothing subscribes: no test here draws a segment.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// mermaid's rendering stack is browser-only and no answer here holds a fence.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import type { UtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerPane } from "../AnswerPane";
import { SpeechControlBar } from "../SpeechControlBar";
import {
  RETRY_OFFER_MS,
  __resetAnswerRetryForTests,
  armRetryOffer,
  beginRetryTicket,
  isRetryOffered,
  noteRetrySentOn,
  noteRetryUtterance,
} from "../answerRetry";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { __resetComposerDraftsForTests } from "../composerDrafts";
import { SUBMIT_RETURN_MS, __resetPtySubmitForTests } from "../ptySubmit";
import {
  __setWebSocketCtorForTests,
  acquireTerminal,
  destroyTerminal,
} from "../terminalInstances";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** Referentially stable — a fresh value per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

const utterance = (id: string): Utterance => ({
  id,
  sessionId: SESSION,
  text: `Answer ${id} explains what the agent did.`,
  at: 1,
});

const queueOf = (u: Utterance): UtteranceQueue => ({
  previous: [],
  current: u,
  pending: [],
  cursor: 0,
});

/**
 * The cell's answer, mutable, because "a newer answer arrives" is a change to
 * what the host reports and not a new host: both surfaces read this on every
 * render, exactly as they read the real queue.
 */
let queue: UtteranceQueue = queueOf(utterance("u-1"));

const speech: GridSpeech = {
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
};

/** A live socket: every frame this file writes lands. */
const send = vi.fn((_data: string) => true);

/** A socket the pool can hold without jsdom dialling anything. */
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  onclose: unknown = null;
  constructor(public url: string) {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
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

/** The row — mounted from the cell whether or not the eye is open. */
const renderBar = (answerOpen = true): RenderResult =>
  render(
    <MemoryRouter>
      <SpeechControlBar
        sessionId={SESSION}
        speech={speech}
        answerOpen={answerOpen}
        onToggleAnswer={() => {}}
        send={send}
      />
    </MemoryRouter>,
  );

/** The pane under it — the half that goes away when the eye closes. */
const renderPane = (): RenderResult =>
  render(
    <MemoryRouter>
      <AnswerPane
        sessionId={SESSION}
        speech={speech}
        onClose={() => {}}
        send={send}
        autoOpen={false}
        onAutoOpenChange={() => {}}
      />
    </MemoryRouter>,
  );

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

/** The retry control, or `null` while no offer stands. */
const retryButton = (): HTMLElement | null =>
  screen.queryByTestId(`answer-pane-retry-enter-${SESSION}`);

/** Type a reply and press the key that sends it. */
function submit(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention"): void => {
  at += 1;
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
};

/**
 * A submit carried all the way to a standing offer: the body, its submitting
 * return a gap later, and the deadline two seconds after that with the session
 * still idle.
 */
function submitAndWaitForOffer(text = "ship it"): void {
  submit(text);
  tick(SUBMIT_RETURN_MS);
  tick(RETRY_OFFER_MS);
}

/** Push into the store the way the bar would if its effect ran now. */
const answerLands = (id: string | null): void => {
  act(() => {
    noteRetryUtterance(SESSION, id);
  });
};

beforeEach(() => {
  at = 0;
  queue = queueOf(utterance("u-1"));
  send.mockClear();
  _resetForTests();
  __resetAnswerRetryForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  vi.useFakeTimers();
  installMatchMedia();
  __setWebSocketCtorForTests(FakeSocket as unknown as new (url: string) => WebSocket);
});

afterEach(() => {
  destroyTerminal(SESSION);
  __setWebSocketCtorForTests(null);
  _resetForTests();
  __resetAnswerRetryForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  vi.useRealTimers();
});

describe("the answer the send replied to", () => {
  /**
   * The id the ticket is measured against comes from the PANE, at the moment
   * the body is written — `beginWaiting` and the ticket are handed the same
   * one, because they are answering the same question about the same send.
   *
   * Asserted from both sides: pushing the recorded id leaves the offer alone,
   * and pushing any other id takes it down. A pane that recorded nothing would
   * fail the first half — with no `sentOn`, every id looks newer.
   */
  it("records the utterance the submit replied to", () => {
    renderBar();
    renderPane();

    submitAndWaitForOffer();
    expect(retryButton()).not.toBeNull();

    // The cell standing still: the bar pushes this on every render that
    // changes nothing, and it must never be read as an arrival.
    answerLands("u-1");
    expect(retryButton()).not.toBeNull();

    // Anything else is the ticket's premise collapsing: something replied.
    answerLands("u-2");
    expect(retryButton()).toBeNull();
  });
});

describe("a reply landing", () => {
  /**
   * The eye is closed, so there is no pane and no composer — and the answer
   * still has to end the ticket, because the user can reopen the pane a minute
   * later and must not find a button offering to press Enter into a
   * conversation that has moved on. The row is what is still mounted, so the
   * row is what notices.
   */
  it("a newer answer clears a standing offer while the pane is closed", () => {
    const bar = renderBar();
    const pane = renderPane();

    submitAndWaitForOffer();
    expect(isRetryOffered(SESSION)).toBe(true);

    // The eye closes: `TerminalView` unmounts the pane and keeps the row.
    pane.unmount();
    expect(isRetryOffered(SESSION)).toBe(true);

    queue = queueOf(utterance("u-2"));
    act(() => {
      bar.rerender(
        <MemoryRouter>
          <SpeechControlBar
            sessionId={SESSION}
            speech={speech}
            answerOpen={false}
            onToggleAnswer={() => {}}
            send={send}
          />
        </MemoryRouter>,
      );
    });

    expect(isRetryOffered(SESSION)).toBe(false);
  });

  /**
   * A remount is not an arrival. Every layout change rebuilds the cell, and an
   * effect that treated its own first run as news would delete the offer the
   * user was reaching for the moment they resized the pane to read it.
   */
  it("a remount on the same answer keeps the ticket", () => {
    const bar = renderBar();
    renderPane();

    submitAndWaitForOffer();
    expect(isRetryOffered(SESSION)).toBe(true);

    bar.unmount();
    renderBar();

    expect(isRetryOffered(SESSION)).toBe(true);
  });

  /**
   * The hazard the store's own guard cannot cover, stated as the sequence that
   * produces it.
   *
   * `noteRetrySentOn` is pushed when the BODY is written, and the body can be
   * written long after the ticket opens: a submit made while another is in
   * flight is queued, and the reconnect path can hold one for up to three
   * seconds. In that window the ticket exists with no recorded id, so any bar
   * render at all would read as a newer answer and take the ticket with it —
   * silently, because nothing is on screen yet to disappear. The user then
   * sends, gets no answer, and gets no offer either.
   *
   * The second submit here is the window: its body is enqueued behind the
   * first submit's return, and the bar remounts — one layout change — before
   * it is written.
   */
  it("a bar remount before the body is delivered keeps the ticket", () => {
    const bar = renderBar();
    renderPane();

    // The first submit takes the session's turn; its return is a gap away.
    submit("first");
    // Written past the queue's turn: the body waits, so this ticket has no
    // recorded id yet.
    submit("second");

    bar.unmount();
    renderBar();

    // The first return, which also hands the queue on: the second body is
    // written here and records its id.
    tick(SUBMIT_RETURN_MS);
    // ...and the second submit's own return, which arms its ticket.
    tick(SUBMIT_RETURN_MS);
    tick(RETRY_OFFER_MS);

    expect(isRetryOffered(SESSION)).toBe(true);
  });
});

describe("the session ending", () => {
  /**
   * Keyed by session id, like the pane state and the wait beside it — so a
   * destroyed session leaves no ticket, no deadline and no activity watch
   * under a name that is about to be reused by a different cell.
   */
  it("destroying the session forgets its retry ticket", () => {
    acquireTerminal(SESSION);

    const generation = beginRetryTicket(SESSION);
    noteRetrySentOn(SESSION, "u-1");
    armRetryOffer(SESSION, generation);
    activity("idle");
    tick(RETRY_OFFER_MS);
    expect(isRetryOffered(SESSION)).toBe(true);

    destroyTerminal(SESSION);

    expect(isRetryOffered(SESSION)).toBe(false);
  });
});

describe("the cell being rebuilt", () => {
  /**
   * The offer belongs to the SEND, not to the component that drew it. A layout
   * change, a preset, a maximize — all of them rebuild `TerminalView`, and an
   * offer held in pane state would vanish exactly when a user who had just
   * sent went to make the cell bigger to watch for the answer.
   */
  it("a terminal-view remount keeps a standing offer", () => {
    const bar = renderBar();
    const pane = renderPane();

    submitAndWaitForOffer();
    expect(retryButton()).not.toBeNull();

    pane.unmount();
    bar.unmount();
    renderBar();
    renderPane();

    expect(retryButton()).not.toBeNull();
  });
});
