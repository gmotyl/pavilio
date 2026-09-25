/**
 * The pane's SECOND trigger: the session's own activity.
 *
 * A send is the user deciding to move on, and hands the body over at once. An
 * agent going busy is not the user's decision, so it waits for the voice to
 * finish the sentence it is reading before it takes the text away. Same
 * destination, different patience — and that difference is what this file
 * pins.
 *
 * ## Why this suite is a store test and not a render test
 *
 * The wait is held OUTSIDE React, keyed by session, for the life of the tab —
 * the pane is remounted by every layout change and a wait held in component
 * state would end the moment the user resized the cell. So the criteria here
 * are criteria about the store: `AnswerPane.waiting.test.tsx` already owns the
 * rendered half, and reaching for a tree here would only re-test it.
 *
 * ## The two negative claims, and how they are made to bite
 *
 * "Nothing here reaches the speech host" and "no timer decides any of it" are
 * both absence claims, and an absence claim asserted carelessly passes over an
 * empty room. So:
 *
 * - the speech modules a handover could plausibly reach for — the queue, the
 *   player, the channel that holds the progress and the host that joins them —
 *   are replaced by recording proxies, and the recorder is PROVEN live at the
 *   top of that test by touching one deliberately before the drive begins. A
 *   future `import { stop } from "../../speech/useSpeechPlayer"` in the waiting
 *   path fails this test without anybody remembering to add it to a list.
 * - the timer test spies on `setTimeout`/`setInterval` under fake timers,
 *   drives the handover AND the deferral, and then advances ten minutes to
 *   show that a clock changes nothing.
 *
 * ## The debounce underneath every `activity("busy")` here
 *
 * The agent's trigger now waits out a window before it may take the body —
 * `busy` is *the PTY emitted output*, and a reattach repaint is output nobody
 * asked for (see `answerWaiting.debounce.test.ts`, which owns that guard). The
 * criteria in THIS file are about what a busy spell means once it is
 * established, so the `activity` helper below elapses that window for a busy
 * broadcast and every test here reads as it always did. The one exception is
 * the timer test, which now has a clock to account for and says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. jsdom would really try, fail,
// and leave that timer in the file — precisely the pollution the "no timer"
// test is about. A socket that never closes keeps the timer table empty.
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
});

/**
 * Every unsubscribe the waiting store has been handed by the activity channel,
 * wrapped so the release can be asserted directly rather than inferred from a
 * session that has stopped reacting (which a dropped entry would also explain).
 */
const unsubscribes: Mock[] = [];

vi.mock("../useTerminalActivityChannel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../useTerminalActivityChannel")>();
  return {
    ...actual,
    subscribeActivity: (
      sessionId: string,
      listener: (state: import("../useTerminalActivityChannel").ActivityState) => void,
    ) => {
      const off = actual.subscribeActivity(sessionId, listener);
      const spy = vi.fn(() => off());
      unsubscribes.push(spy);
      return spy;
    },
  };
});

/** Anything a handover could reach for on the speech side, recorded per access. */
const speechReach: string[] = [];

function recorder(moduleName: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      // Every name exists on a recorder: vitest guards a mock against exports
      // the factory forgot, and this factory deliberately declares none.
      has: () => true,
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        // vitest/esm plumbing, not the implementation reaching for anything.
        if (property === "then" || property === "__esModule") return undefined;
        speechReach.push(`${moduleName}.${property}`);
        return (...args: unknown[]) => {
          speechReach.push(`${moduleName}.${property}(${args.length})`);
        };
      },
    },
  );
}

vi.mock("../../speech/utteranceQueue", () => recorder("utteranceQueue"));
vi.mock("../../speech/useSpeechPlayer", () => recorder("useSpeechPlayer"));
vi.mock("../../speech/useUtteranceChannel", () => recorder("useUtteranceChannel"));
vi.mock("../../speech/useSpeechHost", () => recorder("useSpeechHost"));

// xterm is stubbed for the destroy criterion alone — that one goes through the
// real `destroyTerminal`, because "the watch is released when the session is
// destroyed" is a claim about that function and not about the store's own
// `forget`.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: () => undefined,
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
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import {
  __resetAnswerWaitingForTests,
  beginWaiting,
  getAnswerWaiting,
  noteSpeaking,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";
import {
  __setWebSocketCtorForTests,
  acquireTerminal,
  destroyTerminal,
} from "../terminalInstances";

const SESSION = "cell-a";

/** The body's handover, as the pane reads it. */
const handedOver = (sessionId = SESSION): boolean =>
  getAnswerWaiting(sessionId).waiting;

/** The debounce window these tests run under, pinned on the boot document. */
const DEBOUNCE = 3000;

/**
 * An activity broadcast for the cell, as the server sends it — and, for a busy
 * one, the debounce window that broadcast opens. Every criterion in this file
 * is about an ESTABLISHED busy spell; the window itself is pinned next door.
 */
let at = 0;
const activity = (state: "idle" | "busy" | "attention", sessionId = SESSION): void => {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
  if (state === "busy") vi.advanceTimersByTime(DEBOUNCE);
};

class FakeWs {
  static OPEN = 1;
  readyState = 0;
  onopen: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  onclose: unknown = null;
  constructor(public url: string) {}
  send(): void {}
  close(): void {}
}

beforeEach(() => {
  at = 0;
  speechReach.length = 0;
  unsubscribes.length = 0;
  _resetForTests();
  __resetAnswerWaitingForTests();
  __setWebSocketCtorForTests(FakeWs as unknown as typeof WebSocket);
  // The debounce is a clock, so the whole file runs on a controlled one — and
  // on a window the file states rather than whatever the default happens to
  // be, which is a server-side knob somebody may tune.
  vi.useFakeTimers();
  (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__ = {
    answerWaveDebounceMs: DEBOUNCE,
  };
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  __setWebSocketCtorForTests(null);
  vi.useRealTimers();
  delete (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
});

describe("the answer pane while the session itself is working", () => {
  it("hands the body over when a silent session goes busy", () => {
    watchSessionActivity(SESSION);
    expect(handedOver()).toBe(false);

    activity("busy");

    // Nothing was sent and nothing is being read: the agent is working, and
    // the body says so.
    expect(handedOver()).toBe(true);
  });

  it("waits for the voice to finish before handing the body over", () => {
    watchSessionActivity(SESSION);
    noteSpeaking(SESSION, true);

    activity("busy");

    // Mid-sentence. Taking the text now would pull it out from under a line
    // the user is halfway through hearing.
    expect(handedOver()).toBe(false);

    noteSpeaking(SESSION, false);

    // The sentence finished and the agent is still working.
    expect(handedOver()).toBe(true);
  });

  it("never hands over when the agent finishes before the voice does", () => {
    watchSessionActivity(SESSION);
    noteSpeaking(SESSION, true);

    activity("busy");
    expect(handedOver()).toBe(false);

    // The agent got there first: there is nothing left to wait for, so the
    // deferral must not survive the playback that outlives it.
    activity("idle");
    expect(handedOver()).toBe(false);

    noteSpeaking(SESSION, false);
    expect(handedOver()).toBe(false);
  });

  it("gives the body back when the session goes idle", () => {
    watchSessionActivity(SESSION);
    activity("busy");
    expect(handedOver()).toBe(true);

    // A re-broadcast of the same state is a reading, not a transition.
    activity("busy");
    expect(handedOver()).toBe(true);

    activity("idle");
    expect(handedOver()).toBe(false);
  });

  it("still hands over immediately on a send, mid-sentence", () => {
    watchSessionActivity(SESSION);
    noteSpeaking(SESSION, true);

    // A send is the user's own decision to move on, so it does not wait for
    // the voice — which goes on reading, because nothing here stops it.
    beginWaiting(SESSION, "u-1");

    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(true);
  });

  it("touches nothing on the speech host", async () => {
    // Prove the instrument before trusting its silence: the recorder is a
    // module mock, and a mock nobody imports records nothing whatever the
    // implementation does.
    const queue = (await import("../../speech/utteranceQueue")) as unknown as Record<
      string,
      unknown
    >;
    void queue.utteranceQueueReducer;
    expect(speechReach).toContain("utteranceQueue.utteranceQueueReducer");
    speechReach.length = 0;

    // Every path this task adds, plus the send path it leaves alone.
    watchSessionActivity(SESSION);
    noteSpeaking(SESSION, true);
    activity("busy");
    noteSpeaking(SESSION, false);
    expect(handedOver()).toBe(true);
    beginWaiting(SESSION, "u-1");
    activity("idle");
    expect(handedOver()).toBe(false);

    expect(speechReach).toEqual([]);
  });

  it("schedules no timer to leave the waiting state", () => {
    watchSessionActivity(SESSION);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");

    // The deferral first — the one place a lazy implementation would reach for
    // a clock ("hand over in a second or two") — and then the handover.
    noteSpeaking(SESSION, true);
    activity("busy");
    expect(handedOver()).toBe(false);
    noteSpeaking(SESSION, false);
    expect(handedOver()).toBe(true);

    // ONE clock, and it is the debounce on the way IN: the busy transition
    // opens its window and nothing else is scheduled. The deferral in
    // particular armed and released on pushes alone, which is the claim this
    // test exists to make and the one a "hand over in a second or two"
    // implementation would break.
    expect(timeout.mock.calls.map(([, delay]) => delay)).toEqual([DEBOUNCE]);
    expect(interval).not.toHaveBeenCalled();

    // ...and ten minutes of clock changes nothing: the session is still busy,
    // so the only thing that could end this has not happened — and no second
    // timer was left behind to decide otherwise.
    timeout.mockClear();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(true);
    expect(timeout).not.toHaveBeenCalled();
  });

  it("releases the activity watch when the session is destroyed", () => {
    acquireTerminal(SESSION);

    // The watch is the session's, not a send's: it exists before anything was
    // typed, which is the whole point of the second trigger.
    expect(unsubscribes).toHaveLength(1);
    activity("busy");
    expect(handedOver()).toBe(true);

    destroyTerminal(SESSION);

    expect(unsubscribes[0]).toHaveBeenCalled();
    expect(handedOver()).toBe(false);

    // ...and nothing is listening any more: a late broadcast for a destroyed
    // session leaves the store settled rather than reviving its entry.
    activity("idle");
    activity("busy");
    expect(handedOver()).toBe(false);
  });
});
