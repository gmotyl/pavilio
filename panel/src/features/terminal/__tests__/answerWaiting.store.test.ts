/**
 * The answer-waiting STORE: every trigger that hands the body to the agent,
 * every guard on that handover, and every way back out of it.
 *
 * The wait lives OUTSIDE React, keyed by session, for the life of the tab — the
 * pane is remounted by every layout change and a wait held in component state
 * would end the moment the user resized the cell. So these are criteria about
 * the store; `AnswerPane.waiting.test.tsx` owns the rendered half, and
 * `answerWaiting.mount.test.tsx` the effect order a real tree produces.
 *
 * One `describe` per subject, each opening with the note that explains it:
 * `answerWaiting.activity` (the session's own activity), `.agentStarting` (a
 * launcher press), `.arrival` (an arriving answer), `.attentionFlap` (the
 * busy/attention oscillation), `.debounce` (the window on the agent's claim),
 * `.guards` (witnesses for guards nobody had written one for) and `.lock`
 * (stepping back pins the answer).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. Under fake timers a real dial
// would fail, close, and leave that timer in the table — which is precisely
// what the timer assertions below would then be reading. A socket that never
// closes keeps the table to this module's own timers.
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
 * Every unsubscribe the store hands back. `unsubscribes` holds the spies, so a
 * release can be asserted directly rather than inferred from a session that has
 * stopped reacting (which a dropped entry would also explain); `unsubscribed`
 * records the session id of each one as it is CALLED.
 *
 * "Nothing is left subscribed" is an absence claim, and asserting it on the
 * snapshot alone passes over an empty room: `onActivity` looks its entry up and
 * returns when there is none, so a destroy that forgot to unsubscribe behaves
 * exactly like one that did — right up until the session id is reused. So the
 * channel is wrapped rather than watched from the outside.
 *
 * `speechReach` is anything a handover or a hold could reach for on the speech
 * side, recorded per access.
 */
const { unsubscribes, unsubscribed, speechReach } = vi.hoisted(() => ({
  unsubscribes: [] as Mock[],
  unsubscribed: [] as string[],
  speechReach: [] as string[],
}));

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
      const spy = vi.fn(() => {
        unsubscribed.push(sessionId);
        off();
      });
      unsubscribes.push(spy);
      return spy;
    },
  };
});

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
  beginWaiting,
  forgetAnswerWaiting,
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteAgentStarting,
  noteNewestAnswer,
  noteSpeaking,
  noteTransport,
  noteUtterance,
  releaseAnswer,
  subscribeAnswerWaiting,
  watchSessionActivity,
} from "../answerWaiting";
import {
  __setWebSocketCtorForTests,
  acquireTerminal,
  destroyTerminal,
} from "../terminalInstances";
import {
  DEBOUNCE,
  SESSION,
  activity,
  handedOver,
  reset,
  session,
  settledActivity,
  useWaitingClock,
} from "./answerWaiting.harness";

useWaitingClock();

beforeEach(() => {
  unsubscribes.length = 0;
  unsubscribed.length = 0;
  speechReach.length = 0;
});

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
describe("answerWaiting.activity", () => {
  const activity = settledActivity;

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
    __setWebSocketCtorForTests(FakeWs as unknown as typeof WebSocket);
  });

  afterEach(() => {
    __setWebSocketCtorForTests(null);
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
});

/**
 * The pane's THIRD trigger: the user pressing a launcher pill.
 *
 * The other two both assume a cell that has already spoken. A cell that never
 * has cannot show that its agent is working at all — the pane starts closed and
 * the bar shows launcher pills where the eye would be, so there is no control
 * that opens it and no body to hand over. Pressing a pill is the user asking
 * the agent to start, and that press is the way in.
 *
 * ## Why it is not `beginWaiting`
 *
 * It is a send in every respect but one: nothing was ASKED. `pending` means
 * *the reply to the draft you sent has not landed yet*, and a `start` press is
 * not a question — so the snapshot is `AGENT_HAS_THE_BODY`
 * (`{waiting: true, pending: false}`) rather than `BODY_HANDED_OVER`, and the
 * play button carries no mark for a reply nobody is owed.
 *
 * Everything else it DOES inherit from `beginWaiting`, because both are the
 * same kind of event — a user gesture:
 *
 * - it hands the body over on the frame it is called, with no debounce. The
 *   window guards the AGENT's trigger, where `busy` may be a reattach repaint;
 *   a press is not a reading that might be noise, it is a decision,
 * - it CANCELS a window that was pending, for the same reason: the user's own
 *   decision is a better answer to *is this real?* than any clock,
 * - it releases a standing hold. The hold is the user saying *I want the text*;
 *   asking the agent to start is that same user moving on.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab — the
 * pane is remounted by every layout change. The rendered half belongs to
 * `AnswerPane.waiting.test.tsx`; reaching for a tree here would only re-test it
 * and would put React's scheduling between the clock and the assertion.
 */
describe("answerWaiting.agentStarting", () => {
  describe("a launcher press begins a wait", () => {
    it("starting the agent hands the body over with no pending mark", () => {
      watchSessionActivity(SESSION);

      noteAgentStarting(SESSION);

      // The body is the wave's, exactly as it is for an agent that went busy on
      // its own account...
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    });

    it("the handover is synchronous, not debounced", () => {
      watchSessionActivity(SESSION);

      noteAgentStarting(SESSION);

      // ...on the frame the user pressed it. The debounce asks whether a busy
      // spell was REAL, and a press is not a reading that might be noise.
      expect(handedOver()).toBe(true);
      // Pinned on the timer table as well as on the body: an implementation that
      // opened a window and happened to publish early would pass the line above
      // and still be a press the clock gets a say in.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("an arriving utterance ends an agent-starting wait", () => {
      watchSessionActivity(SESSION);
      // The first push is SEEDING, not an arrival — the store cannot read where a
      // cell stands from a fact it has never been told. A cell that has never
      // spoken seeds with `null`, which is exactly the cell a launcher press is
      // pressed on.
      noteNewestAnswer(SESSION, null);

      noteAgentStarting(SESSION);
      expect(handedOver()).toBe(true);

      // The answer the press was waiting for. The wave stood in for a body that
      // had nothing in it; now it has.
      noteNewestAnswer(SESSION, "u-1");

      expect(handedOver()).toBe(false);
    });

    it("an agent that goes idle without speaking ends the wait", () => {
      watchSessionActivity(SESSION);

      noteAgentStarting(SESSION);
      // The launched agent writes to the PTY, which is what puts the session
      // busy. The wave is already up, so the window this opens decides nothing
      // the press has not already decided.
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(true);

      // The exit that makes the whole feature shippable: an agent that finished
      // without ever speaking. Nothing arrives, and the wait still ends.
      activity("idle");

      expect(handedOver()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("destroying the session ends the wait and leaves nothing subscribed", () => {
      watchSessionActivity(SESSION);
      noteAgentStarting(SESSION);
      expect(handedOver()).toBe(true);

      // `destroyTerminal` calls exactly this.
      forgetAnswerWaiting(SESSION);

      expect(handedOver()).toBe(false);
      expect(unsubscribed).toEqual([SESSION]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("starting the agent releases a standing hold", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);

      // The user stepped back for the text, which outranks every claim on the
      // body.
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      noteAgentStarting(SESSION);

      // ...until the same user asks the agent to start, which is them moving on
      // — the same release `beginWaiting` makes, for the same reason. Without it
      // `derive` would answer the press with the old answer on the body and no
      // wave at all.
      expect(isAnswerHeld(SESSION)).toBe(false);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    });

    it("starting the agent is not overtaken by a pending window", () => {
      watchSessionActivity(SESSION);

      // A busy spell already being weighed — a reattach repaint on the cell the
      // user is about to press into is the ordinary way this happens.
      activity("busy");
      vi.advanceTimersByTime(1000);
      expect(vi.getTimerCount()).toBe(1);

      noteAgentStarting(SESSION);

      // A user gesture is never overtaken by a window: the press answers the
      // question the window was asking, so the window goes rather than being
      // left to fire behind a decision already made.
      expect(handedOver()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a still-busy agent gets no window back when an answer ends the starting wait", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, null);

      // The press lands on a session that was ALREADY busy, so its own output
      // continues that spell rather than starting a new one — no transition, and
      // therefore no window of its own. The only window this run will ever see
      // is the one the press cancelled.
      activity("busy");
      vi.advanceTimersByTime(1000);
      noteAgentStarting(SESSION);
      expect(vi.getTimerCount()).toBe(0);

      // The answer lands and the starting wait is over. The session is still
      // busy, but the arrival IS the agent stopping (ADR 0018): the PTY output
      // that continues is the tail of the spell that just ended.
      noteNewestAnswer(SESSION, "u-1");
      expect(handedOver()).toBe(false);

      // So the press owes no window back, and the answer keeps the body for as
      // long as this spell lasts. Only a fresh busy spell earns the wave again.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * DEBOUNCE);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    });
  });
});

/**
 * An arriving answer IS the agent stopping (ADR 0018).
 *
 * The Stop hook posts an utterance when the agent finishes its turn, so an
 * answer landing for the cell is the most authoritative "the agent stopped"
 * this module is ever told — better than `attention`, which is ambiguous, and
 * earlier than `idle`, which a finished agent sitting at `attention` never
 * reaches on its own. So an arrival ends the busy spell outright: the wave
 * goes, the quiet window goes, a pending debounce goes and is NOT re-opened,
 * a hold is released, and a launcher's starting wait is over.
 *
 * What it does NOT end is a SEND. A send is the user's own wait, and its way
 * out is `noteUtterance` comparing against the id the draft was sent on.
 *
 * The rest of the busy spell is left where it is: `activity` stays `busy`, so
 * the wave can only come back on a FRESH spell — the session leaving `busy`
 * and entering it again — never on output that merely continues this one.
 */
describe("answerWaiting.arrival", () => {
  const SETTLED = { waiting: false, pending: false };
  const AGENT_HAS_THE_BODY = { waiting: true, pending: false };
  const BODY_HANDED_OVER = { waiting: true, pending: true };

  const snapshot = () => session();

  /** A cell whose agent has been working long enough to own the body. */
  const waveUp = (): void => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
  };

  describe("an arriving answer ends the wave", () => {
    it("an arriving answer ends a wave that holds the body", () => {
      waveUp();

      // The session is still busy — the Stop hook fires before the PTY has
      // finished repainting — and the answer still gets the body at once.
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
      expect(snapshot()).toEqual(SETTLED);
    });

    it("an arriving answer during the quiet window ends it", () => {
      waveUp();
      activity("attention");
      // The quiet window is pending: the wave stays until it elapses.
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);

      noteNewestAnswer(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);
      // Cancelled outright, not merely left to fire into a settled entry.
      expect(vi.getTimerCount()).toBe(0);

      // The window had nothing left to decide, so its elapsing changes nothing.
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("an answer during the debounce keeps the wave away while the spell stays busy", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u-0");
      activity("busy");
      vi.advanceTimersByTime(1000);

      noteNewestAnswer(SESSION, "u-1");

      // The spell stays busy well past the window that was pending, and no
      // fresh window is opened in its place.
      vi.advanceTimersByTime(10 * DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("output continuing after the arrival does not bring the wave back", () => {
      waveUp();
      noteNewestAnswer(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);

      // The PTY keeps emitting: the server re-broadcasts the state it is already
      // in, which is no transition at all.
      for (let i = 0; i < 5; i += 1) {
        activity("busy");
        vi.advanceTimersByTime(DEBOUNCE);
        expect(snapshot()).toEqual(SETTLED);
      }
    });

    it("a fresh busy spell after the arrival brings the wave back", () => {
      waveUp();
      noteNewestAnswer(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);

      activity("idle");
      activity("busy");
      // Debounced as ever: the transition alone proves nothing.
      vi.advanceTimersByTime(DEBOUNCE - 1);
      expect(snapshot()).toEqual(SETTLED);

      vi.advanceTimersByTime(1);
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
    });

    it("an arriving answer releases a hold and settles the body while busy", () => {
      waveUp();
      holdAnswer(SESSION);
      expect(isAnswerHeld(SESSION)).toBe(true);

      // `true` is still the surface's cue to put its cursor on the newest answer.
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(true);
      expect(isAnswerHeld(SESSION)).toBe(false);
      // Released AND settled — not handed back to the agent's claim.
      expect(snapshot()).toEqual(SETTLED);
    });

    it("a sent draft's wave is not ended by the arrival alone", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u-0");
      beginWaiting(SESSION, "u-0");
      expect(snapshot()).toEqual(BODY_HANDED_OVER);

      noteNewestAnswer(SESSION, "u-1");
      expect(snapshot()).toEqual(BODY_HANDED_OVER);

      // The send's own way out.
      noteUtterance(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);
    });

    it("a send ending after the arrival does not bring the wave back", () => {
      // The cursor lags the newest answer: the user sent while the voice was
      // still reading, so the reply is appended to the queue (the arrival) and
      // the cursor reaches it only later, when playback gets there (the end of
      // the send). The PTY is still busy throughout.
      waveUp();
      beginWaiting(SESSION, "u-0");
      expect(snapshot()).toEqual(BODY_HANDED_OVER);

      noteNewestAnswer(SESSION, "u-1");
      noteUtterance(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);

      // The end of the send owes no window back: the arrival already ended the
      // spell that window would have weighed.
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a fresh busy spell after a send that ended past the arrival still brings the wave back", () => {
      waveUp();
      beginWaiting(SESSION, "u-0");
      noteNewestAnswer(SESSION, "u-1");
      noteUtterance(SESSION, "u-1");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);

      activity("idle");
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
    });

    it("a remount after the arrival does not bring the wave back", () => {
      waveUp();
      noteNewestAnswer(SESSION, "u-1");

      // A layout change re-opens the watch on a session still busy with the
      // answered spell's tail. That is not a session that went busy again.
      watchSessionActivity(SESSION);
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a send made after the arrival is still owed its window back", () => {
      waveUp();
      noteNewestAnswer(SESSION, "u-1");

      // New work on a PTY that never left busy. The send ends WITHOUT an arrival
      // of its own — a Previous press moves the cursor off the id it was sent on
      // — and the agent is still working, so the wave comes back a window later.
      beginWaiting(SESSION, "u-1");
      noteUtterance(SESSION, "u-0");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
    });

    it("the same answer reported twice changes nothing", () => {
      waveUp();

      expect(noteNewestAnswer(SESSION, "u-0")).toBe(false);
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
    });

    it("an arriving answer ends a launcher's starting wait", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, null);
      noteAgentStarting(SESSION);
      expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);

      activity("busy");
      noteNewestAnswer(SESSION, "u-1");
      expect(snapshot()).toEqual(SETTLED);

      // The press's window is not owed back on an arrival: the agent stopped.
      vi.advanceTimersByTime(10 * DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
    });
  });
});

/**
 * The pane must not flicker while an agent is genuinely working.
 *
 * ## The fact underneath this file
 *
 * The server's activity model has THREE states, not two, and `attention` is
 * NOT "the agent stopped". `terminalActivity.ts` promotes a session to
 * `attention` one `IDLE_DEBOUNCE_MS` after its last byte whenever the busy run
 * lasted longer than `BUSY_THRESHOLD_MS` — and `recordOutput` then BACKDATES
 * `busyStartedAt` past that threshold, so every later gap resolves to
 * `attention` again and never to `idle`.
 *
 * For an agent that thinks between bursts of output — a tool call, a pause, a
 * result, a pause — that is not a state at all but an OSCILLATION:
 * busy → attention → busy → attention for the whole run, one broadcast per
 * flip. `terminalActivity.test.ts` pins that sequence at the source; this file
 * is what the pane must do when it arrives.
 *
 * The reported symptom was exactly the shape of that sequence: "the answer
 * panel goes back to last answer by itself even when the busy indicator is
 * still red — few seconds answer, few seconds wave". The indicator stayed lit
 * because `attention` lights it too. The pane flickered because it read every
 * non-busy state as the agent letting go of the body.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab; the
 * rendered half is `AnswerPane.waiting.test.tsx`'s. Reaching for a tree here
 * would only re-test it, and would put React's scheduling between the
 * broadcast and the assertion.
 */
describe("answerWaiting.attentionFlap", () => {
  /**
   * One turn of the flap a working agent produces, as the server broadcasts it:
   * output (`busy`), long enough to be work, then a gap longer than the server's
   * idle debounce, which for a long run promotes to `attention` rather than to
   * `idle`.
   */
  const oneBurst = (): void => {
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE + 500);
    activity("attention");
    vi.advanceTimersByTime(1500);
  };

  describe("a working agent's pane does not oscillate", () => {
    /**
     * The sequence the user actually hit, in their words: *"I did not navigate
     * answers but I did read the answer that came, the answer was steady while
     * reading and the wave started flickering as soon as the read stopped."*
     *
     * The flap was there the whole time. The DEFERRAL was hiding it: the window
     * elapses while the voice is reading, so the claim it grants is armed and
     * deferred in the same breath and `derive` keeps the body on the answer —
     * steady, for the length of the read, however many times the server flips
     * the session between `busy` and `attention` underneath. `noteSpeaking(…,
     * false)` takes that lid off, and from then on every flip is visible.
     *
     * So the deferral and the hold are two lids on one pot, and this is the
     * cheaper reproduction of the two: it needs no transport press at all.
     */
    it("is steady while the voice reads, and STAYS steady when the read ends", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u1");

      // An answer lands for a working agent, and the voice starts reading it.
      activity("busy");
      noteNewestAnswer(SESSION, "u2");
      noteSpeaking(SESSION, true);
      vi.advanceTimersByTime(DEBOUNCE + 500);

      // The body keeps the answer: the arrival ended this first spell outright
      // (ADR 0018), and every later spell's claim is deferred against the
      // sentence being read. This half was never broken.
      expect(handedOver()).toBe(false);

      const whileReading: boolean[] = [];
      for (let i = 0; i < 3; i += 1) {
        activity("attention");
        vi.advanceTimersByTime(1500);
        whileReading.push(handedOver());
        activity("busy");
        vi.advanceTimersByTime(DEBOUNCE + 500);
        whileReading.push(handedOver());
      }
      expect(whileReading).toEqual([false, false, false, false, false, false]);

      // The read ends. The lid comes off: the agent is still working, so the
      // wave is right — and it must now STAY, rather than blinking off at the
      // agent's next pause and back on one window later.
      noteSpeaking(SESSION, false);
      expect(handedOver()).toBe(true);

      const afterReading: boolean[] = [];
      for (let i = 0; i < 3; i += 1) {
        activity("attention");
        vi.advanceTimersByTime(1500);
        afterReading.push(handedOver());
        activity("busy");
        vi.advanceTimersByTime(DEBOUNCE + 500);
        afterReading.push(handedOver());
      }
      // Before the fix this read [false, true, false, true, false, true] — the
      // flicker, starting the moment the read stopped, exactly as reported.
      expect(afterReading).toEqual([true, true, true, true, true, true]);
    });

    it("keeps the body through the busy<->attention flap of a thinking agent", () => {
      watchSessionActivity(SESSION);

      // The agent starts and earns the body the ordinary way.
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(true);

      // Now it thinks. Each gap between bursts arrives as `attention`, because
      // the run has already outlived the server's busy threshold. None of them
      // is the agent finishing, so none of them may give the body back.
      const seen: boolean[] = [];
      for (let i = 0; i < 4; i += 1) {
        activity("attention");
        vi.advanceTimersByTime(1500);
        seen.push(handedOver());
        activity("busy");
        vi.advanceTimersByTime(DEBOUNCE + 500);
        seen.push(handedOver());
      }

      // Before the fix this read [false, true, false, true, ...] — the flicker
      // the user reported, with the debounce window setting its period.
      expect(seen).toEqual([true, true, true, true, true, true, true, true]);
    });

    it("gives the body back the moment the agent really stops", () => {
      watchSessionActivity(SESSION);
      oneBurst();
      oneBurst();
      expect(handedOver()).toBe(true);

      // `idle` is the one exit the agent cannot fake: the server reaches it only
      // from a short run, or from a user gesture on an attention session.
      activity("idle");
      expect(handedOver()).toBe(false);
    });

    it("gives the body back one window after an agent finishes into attention", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(true);

      // The agent finished and is asking the user something. That arrives as
      // `attention` — the same broadcast a gap between bursts makes — so the
      // pane does not act on it yet.
      activity("attention");
      vi.advanceTimersByTime(DEBOUNCE - 1);
      expect(handedOver()).toBe(true);

      // ...and acts when the silence outlives the window. This is the cost of
      // the fix, paid once at the END of a run, and it is the reason `attention`
      // is not simply left to the agent: a finished agent sitting there never
      // reaches `idle` on its own, so a wave that waited for `idle` would wait
      // for the rest of the session.
      vi.advanceTimersByTime(1);
      expect(handedOver()).toBe(false);

      // Ten more minutes of it change nothing further.
      vi.advanceTimersByTime(600_000);
      expect(handedOver()).toBe(false);
    });

    it("schedules nothing once the quiet window has been answered", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);

      // The flap, then a real stop. Neither window may be left running: a stale
      // quiet timer would hand a later busy spell's body back for no reason.
      oneBurst();
      activity("idle");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a send's wait survives the flap and still ends on the reply", () => {
      watchSessionActivity(SESSION);
      beginWaiting(SESSION, "u1");
      noteNewestAnswer(SESSION, "u1");
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });

      // The agent works on the reply, thinking between bursts.
      oneBurst();
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
      oneBurst();
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });

      // The reply lands — the cursor moves onto an id that is not the one the
      // draft was sent on — so the send is over and the mark goes with it. The
      // agent is still working, so the body stays the agent's.
      noteNewestAnswer(SESSION, "u2");
      noteUtterance(SESSION, "u2");
      expect(getAnswerWaiting(SESSION).pending).toBe(false);
    });
  });

  describe("a hold the user took survives a blip", () => {
    it("keeps the hold through an attention gap in a working agent's run", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u1");

      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(true);

      // *Previous*: the user stepping back to re-read while the agent works.
      noteTransport(SESSION);
      holdAnswer(SESSION);
      expect(isAnswerHeld(SESSION)).toBe(true);
      expect(handedOver()).toBe(false);

      // The agent pauses between bursts. That is not the user's hold being
      // over — nothing the user did released it, and the agent has not stopped.
      activity("attention");
      vi.advanceTimersByTime(1500);
      expect(isAnswerHeld(SESSION)).toBe(true);

      // ...and the burst that follows must not raise the wave over the text the
      // user asked to keep looking at.
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE + 500);
      expect(isAnswerHeld(SESSION)).toBe(true);
      expect(handedOver()).toBe(false);
    });

    it("still releases the hold when the agent actually finishes", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u1");

      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      holdAnswer(SESSION);
      expect(isAnswerHeld(SESSION)).toBe(true);

      oneBurst();
      expect(isAnswerHeld(SESSION)).toBe(true);

      activity("idle");
      expect(isAnswerHeld(SESSION)).toBe(false);
    });
  });
});

/**
 * The guard on the pane's SECOND trigger: `busy` is not "the agent is working".
 *
 * Server-side, `recordOutput()` sets a session busy whenever its PTY emits
 * output, and lets it fall back to idle a second after the last byte. That is a
 * good proxy for "an agent is working" in the middle of a session and a bad one
 * at attach time, when a repaint is guaranteed: switching terminals or projects
 * reattaches the session and repaints the screen, which is output, so a switch
 * produces a 1-2s busy window with no agent work in it at all — and that window
 * was enough to cover an answer the user was still reading.
 *
 * So the agent's trigger waits out a window before it may take the body. This
 * file pins that window from both sides: a busy spell shorter than it never
 * reaches the body, and a busy spell longer than it hands over exactly as
 * before.
 *
 * ## What is deliberately NOT debounced
 *
 * A send is the user's own action, and delaying its feedback by three seconds
 * would make the panel feel broken. `beginWaiting` therefore hands over on the
 * frame it is called, and CANCELS any window that was pending — the user's
 * decision is the better answer to "is this real?" than any clock.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab; the
 * rendered half is `AnswerPane.waiting.test.tsx`'s. Reaching for a tree here
 * would only re-test it, and would put React's own scheduling between the clock
 * and the assertion.
 */
describe("answerWaiting.debounce", () => {
  describe("the debounce on the agent's claim to the body", () => {
    it("a busy window shorter than the debounce never reaches the body", () => {
      watchSessionActivity(SESSION);

      activity("busy");
      // The transition alone proves nothing: output happened, which is all the
      // server ever said.
      expect(handedOver()).toBe(false);

      vi.advanceTimersByTime(DEBOUNCE - 1);
      expect(handedOver()).toBe(false);

      activity("idle");

      // ...and the window that was still pending is gone with it: an idle
      // session has nothing left to prove, so no later tick may hand the body to
      // an agent that has already stopped.
      //
      // Asserted on the TIMER TABLE, not only on the body. A window left running
      // behind an idle session happens to be harmless on the way out — the fired
      // callback re-reads `activity` and returns — so a purely behavioural
      // assertion here goes on passing with the cancellation deleted, and the
      // half of the rule that keeps stale timers out of the table would be
      // pinned by nothing at all.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(false);
    });

    it("a busy window longer than the debounce hands the body over", () => {
      watchSessionActivity(SESSION);

      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);

      // Output that has persisted past the window is work, not a repaint, and
      // the body says so — exactly as it did before the debounce existed.
      expect(handedOver()).toBe(true);
      // Nothing was SENT, so no reply is outstanding and the play button carries
      // no mark: the debounce changes when the agent's trigger fires, not what
      // it means.
      expect(getAnswerWaiting(SESSION).pending).toBe(false);
    });

    it("a reattach repaint of 1.2s leaves the answer on screen", () => {
      watchSessionActivity(SESSION);

      // The case the whole guard exists for, in the shape the server produces
      // it: the user switches to this terminal, the session reattaches, the
      // screen repaints, and `recordOutput()` calls that busy for as long as the
      // bytes keep coming plus its own idle second.
      activity("busy");
      vi.advanceTimersByTime(1200);
      // Still mid-window, and the answer is still on screen: this is the frame
      // the old behaviour covered it on.
      expect(handedOver()).toBe(false);

      activity("idle");
      expect(handedOver()).toBe(false);

      // The answer they were reading is still theirs a full ten minutes later:
      // nothing is left armed to take it away.
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(false);
    });

    it("an arriving utterance cancels a pending debounce", () => {
      watchSessionActivity(SESSION);
      // The first push is seeding, not an arrival — the store cannot tell where a
      // cell stands from a fact it has never been told.
      noteNewestAnswer(SESSION, "u-0");

      activity("busy");
      vi.advanceTimersByTime(1000);

      // The answer landed inside the window. It is the better outcome than a
      // wave — one raised now would cover the very thing it announces — so the
      // window that was about to raise one is cancelled and the answer gets the
      // screen to itself.
      noteNewestAnswer(SESSION, "u-1");

      // The cancellation, pinned on the clock: the window this spell opened
      // would have fired on this tick, and nothing does.
      vi.advanceTimersByTime(DEBOUNCE - 1000);
      expect(handedOver()).toBe(false);

      // No fresh window replaces it, busy or not (ADR 0018 — the arrival is the
      // agent stopping; the still-busy case is `answerWaiting.mount`'s "an answer
      // landing inside the window" and `answerWaiting.arrival`'s). Here the
      // session goes idle too, and the answer keeps the body for good.
      activity("idle");
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(false);
    });

    it("a send during the debounce hands over immediately", () => {
      watchSessionActivity(SESSION);

      activity("busy");
      vi.advanceTimersByTime(1000);
      expect(handedOver()).toBe(false);

      // The user's own action, on the frame they took it. Debouncing this would
      // be three seconds of a panel that looks broken.
      beginWaiting(SESSION, "u-1");
      expect(handedOver()).toBe(true);
      expect(getAnswerWaiting(SESSION).pending).toBe(true);

      // ...and the window it overtook is cancelled rather than left to fire
      // behind it: the send is a better answer to "is this real?" than the clock
      // it replaced.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(true);
    });

    it("destroying the session clears the pending timer", () => {
      watchSessionActivity(SESSION);

      activity("busy");
      vi.advanceTimersByTime(1000);
      expect(vi.getTimerCount()).toBe(1);

      // `destroyTerminal` calls exactly this (see `answerWaiting.activity`'s own
      // destroy criterion, which goes through the real one).
      forgetAnswerWaiting(SESSION);

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(false);
    });

    it("repeated busy events do not stack timers", () => {
      watchSessionActivity(SESSION);
      const timeout = vi.spyOn(globalThis, "setTimeout");

      activity("busy");
      vi.advanceTimersByTime(500);
      // A server re-broadcast of the state a session is already in is a reading,
      // not a transition — and even if it reached this far, a window already
      // running is the window this busy spell gets.
      activity("busy");
      activity("busy");

      expect(timeout.mock.calls.filter(([, delay]) => delay === DEBOUNCE)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);

      // And the one window that IS running is the one the FIRST event started,
      // so it elapses on that event's clock rather than being pushed back by
      // every byte the agent writes.
      vi.advanceTimersByTime(DEBOUNCE - 500);
      expect(handedOver()).toBe(true);
    });

    it("the playback deferral still applies after the debounce elapses", () => {
      watchSessionActivity(SESSION);
      noteSpeaking(SESSION, true);

      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);

      // Two independent questions, asked in order: the debounce asked whether
      // the busy was real and got a yes, and the deferral now asks whether this
      // is a rude moment and gets one too. Taking the text here would pull it
      // out from under a sentence the user is halfway through hearing.
      expect(handedOver()).toBe(false);

      noteSpeaking(SESSION, false);

      // The sentence finished and the agent is still working.
      expect(handedOver()).toBe(true);
    });
  });
});

/**
 * The guards nobody had written a witness for.
 *
 * Every test in this file was added because a reviewer PROBED the module
 * rather than read it: each of the three guards below could be deleted and the
 * whole terminal suite still went green, while the behaviour measurably moved.
 * A guard with no witness is a line the next person is entitled to delete.
 *
 * - `endStarting`'s `if (!entry.starting) return;` — remove it and an arrival
 *   on a cell that never pressed a launcher schedules a window on the press's
 *   account (0 timers becomes 1). `endStarting` is gone since ADR 0018 — the
 *   arrival is the agent stopping and owes no window to anyone — and the
 *   witness is kept as the rule's: an arrival schedules nothing,
 * - `noteAgentStarting`'s `entry.deferred = false` — under ADR 0016 removing it
 *   made a press made while the voice is reading over a working agent lose the
 *   wave at the moment its own arrival landed. Since ADR 0018 the arrival ends
 *   the wave anyway, and the test now pins that; the line's live witness is a
 *   press over a send shrunk to its mark, where it alone hands over the body,
 * - `watchSessionActivity`'s `!entry.starting` — which did not exist until this
 *   file was written, and is the durable half of the rule the other two serve:
 *   a user gesture is never overtaken by a window, INCLUDING across the
 *   remount a layout change makes.
 *
 * The fourth subject here is not a guard but a claim: `endSend`'s docstring
 * used to say that a transport press is never one of the things that ends a
 * send. That is true of `noteTransport` — the FUNCTION — and false of the
 * *Next answer* PRESS, which also moves the cursor, which reaches the store as
 * `noteUtterance` one effect later, which DOES end the send. It is live,
 * shipped behaviour and it is pinned below rather than changed.
 *
 * ## Why this is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab. The
 * calls below are exactly the ones `SpeechControlBar` makes, in the order it
 * makes them — the button's `onClick` first, the cursor the press moved one
 * effect later — and mounting a tree to produce that order would put React's
 * scheduling between the clock and the assertion without asserting anything
 * more.
 */
describe("answerWaiting.guards", () => {
  describe("a transport press that moves the cursor ends the send", () => {
    it("*Next answer* ends a pending send and gives the window back", () => {
      watchSessionActivity(SESSION);
      // The first push is SEEDING: an entry that has never been told where the
      // cell stands cannot tell an arrival from a starting point.
      noteNewestAnswer(SESSION, "u-1");

      // The agent is already working when the user types, so the send spends a
      // window that was weighing real work.
      activity("busy");
      beginWaiting(SESSION, "u-1");
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
      expect(vi.getTimerCount()).toBe(0);

      // The bar's *Next answer* button, in the order it fires them: the click
      // handler first...
      noteTransport(SESSION);
      releaseAnswer(SESSION);
      // ...which alone only SHRINKS the wait to its mark. This is the half the
      // docstring's "a transport press is NOT one of them" is true of.
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: true });

      // ...and then the cursor the press moved, which reaches the store from
      // `SpeechControlBar`'s own effect one commit later. *Next* is enabled only
      // when there IS something newer to step to, so this is the user stepping
      // onto an answer the cell did not have when they pressed Enter — which is
      // the event `endSend` exists for.
      noteUtterance(SESSION, "u-2");

      // So the mark goes, and it is right that it does: a newer answer is on the
      // body, which is what the mark was waiting to be able to say.
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
      // And the window the send spent is paid back, exactly as it is for any
      // other end of a send: the agent is still working and nothing will
      // re-announce a state it never left.
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(DEBOUNCE);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    });

    it("*Previous answer* ends the send too, but the hold keeps the wave off", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u-1");
      activity("busy");
      beginWaiting(SESSION, "u-1");

      // The bar's *Previous answer* button: the same `noteTransport`, and a
      // `holdAnswer` beside it.
      noteTransport(SESSION);
      holdAnswer(SESSION);
      // Stepping BACK moves the cursor too — onto an older id, which is still
      // "not the one the draft was sent on" — so the same `endSend` runs.
      noteUtterance(SESSION, "u-0");
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });

      // What the hold masks is not the mark but the WAVE: the window the send
      // gave back fires, the agent earns its claim, and `derive` still answers
      // with the text, because the hold outranks every claim on the body.
      vi.advanceTimersByTime(DEBOUNCE);
      expect(isAnswerHeld(SESSION)).toBe(true);
      expect(handedOver()).toBe(false);
    });
  });

  describe("an arrival never pays a debt a launcher press never took on", () => {
    it("an arrival on a cell that never pressed a pill schedules no window", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u-0");

      // A busy spell being weighed, and a send that spends it — the user's own
      // decision is a better answer to *is this real?* than any clock.
      activity("busy");
      expect(vi.getTimerCount()).toBe(1);
      beginWaiting(SESSION, "u-0");
      expect(vi.getTimerCount()).toBe(0);

      // The answer lands. An arrival re-opens nothing on its own account — it is
      // the agent stopping (ADR 0018) — and ending the starting wait owes no
      // window either: nothing was ever pressed here. The send's own debt is
      // `endSend`'s to pay, from the site that knows a send was outstanding.
      noteNewestAnswer(SESSION, "u-1");
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("a launcher press drops the playback deferral for good", () => {
    it("the arrival ends the wave even when the press was made mid-sentence", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, null);

      // The voice is reading when the agent goes to work, so the handover is
      // DEFERRED: taking the text away here pulls it out from under a sentence
      // the listener is halfway through hearing.
      noteSpeaking(SESSION, true);
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(false);

      // The user presses a launcher pill anyway. The deferral is politeness
      // towards a sentence an AGENT interrupted, and the user interrupting
      // themselves is not that — so it is dropped, not merely outranked.
      noteAgentStarting(SESSION);
      expect(handedOver()).toBe(true);

      // The answer the press was waiting for. It ends the STARTING wait and,
      // being the agent stopping (ADR 0018), the agent's own armed claim with
      // it: the body renders the answer although the session is still busy.
      // (Under ADR 0016 the claim survived the arrival, and this was where the
      // dropped deferral showed — the body passed straight to the wave.)
      noteNewestAnswer(SESSION, "u-1");
      expect(handedOver()).toBe(false);

      // ...and output continuing this spell does not bring the wave back.
      vi.advanceTimersByTime(10 * DEBOUNCE);
      expect(handedOver()).toBe(false);
    });

    it("a press over a send shrunk to its mark hands the deferred claim the body", () => {
      // The one corner where the line is observable today: with a send pending,
      // `derive` asks the agent's claim as `agentArmed && !deferred`, and the
      // press is what clears `deferred`. (`starting` is not read while a send is
      // pending, so it cannot carry the handover on its own.)
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, "u-1");

      noteSpeaking(SESSION, true);
      beginWaiting(SESSION, "u-1");
      // A transport press SHRINKS the send to its mark: the body is the answer's.
      noteTransport(SESSION);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: true });

      // The agent goes to work and outlives the window, mid-sentence: the claim
      // is granted but deferred, so the body stays on the answer.
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: true });

      // The launcher press drops the deferral, and the armed claim takes the body.
      noteAgentStarting(SESSION);
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
    });
  });

  describe("a remount does not overtake a launcher press", () => {
    it("re-opening the watch on a starting cell schedules no window", () => {
      watchSessionActivity(SESSION);
      noteNewestAnswer(SESSION, null);

      // The press lands on a session that was ALREADY busy — a reattach repaint
      // is the ordinary way that happens — and spends the window that spell had
      // open.
      activity("busy");
      vi.advanceTimersByTime(1000);
      noteAgentStarting(SESSION);
      expect(vi.getTimerCount()).toBe(0);

      // A layout change: maximize, a preset, a drag, a seam resize. Every one of
      // them remounts `TerminalView`, whose effect re-opens the session's watch —
      // which is the whole reason this wait lives outside React.
      watchSessionActivity(SESSION);

      // `send` was never the only gesture worth protecting. A window opened here
      // would fire a moment later and hand the agent a claim the press had
      // already cancelled — a clock deciding a question the user had answered.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(true);

      // The arrival ends the starting wait as the agent STOPPING (ADR 0018):
      // the press owes no window back, and output continuing this busy spell
      // does not bring the wave back.
      noteNewestAnswer(SESSION, "u-1");
      expect(handedOver()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(DEBOUNCE);
      expect(handedOver()).toBe(false);
    });
  });
});

/**
 * The pane's LOCK: stepping back through the transport pins the answer.
 *
 * Without it the feature eats itself. Task 4 gave the body to any busy
 * session, so a user who steps back to re-read something loses the text again
 * on the very next activity broadcast. The hold is the statement "I want the
 * text", and it outranks the agent's claim on the body for as long as it
 * stands.
 *
 * ## What releases it, and what does not
 *
 * FOUR things release it, and every one of them is something that HAPPENED: a
 * forward transport press, a new answer landing, a draft being SENT — sending
 * is the user moving on, so the answer they stepped back to read is no longer
 * what they are waiting to see — and the session leaving `busy`, because a hold
 * with nothing to hold it against is not a hold, it is a stuck pane. Nothing
 * else does, and no clock does, on either the setting or the releasing side.
 *
 * ## The cursor snap, and why it is a RETURN VALUE
 *
 * An arrival releasing the hold has to leave the body showing the answer that
 * just landed, and Task 1's reducer deliberately parks the cursor on the
 * utterance it was already on when an answer arrives. So the release has to be
 * accompanied by a cursor reset — and this module owns no cursor and may not
 * reach for one: its imports are {react, the activity channel} and a read of
 * the speech host would be a coupling just as surely as a command would.
 *
 * So the arrival comes IN as a push, exactly like every other fact this module
 * is told, and the answer goes back OUT as `noteNewestAnswer`'s return value:
 * `true` means "that arrival released a hold", which is the surface's cue to
 * put its own cursor back on the newest answer. The module owns the hold, the
 * surface owns the cursor, and neither reaches into the other.
 *
 * ## How the negative claims are made to bite
 *
 * - "no timer releases it" spies on `setTimeout`/`setInterval` under fake
 *   timers, sets the hold, and then advances ten minutes to show that a clock
 *   changes nothing either way.
 * - "nothing here reaches the speech host" replaces the four speech modules a
 *   handover could plausibly reach for with recording proxies and asserts the
 *   recorder stayed silent after EVERY test in the file — the instrument is
 *   proven live in `answerWaiting.activity.test.ts`, which touches one of
 *   these recorders deliberately before trusting its silence.
 */
describe("answerWaiting.lock", () => {
  /**
   * Every busy broadcast here elapses the debounce window it opens. The hold is
   * a claim about an ESTABLISHED busy spell ("the agent has the body and the user
   * wants the text back"), so every criterion here wants the spell the window
   * already allowed; the window itself is pinned in `answerWaiting.debounce`.
   */
  const activity = settledActivity;

  afterEach(() => {
    reset();
    // The module's one standing discipline, asserted after every drive in this
    // section rather than in a test of its own: a hold that reached for the
    // queue, the player, the channel or the host would show up here.
    expect(speechReach).toEqual([]);
  });

  describe("the answer pane when the user steps back", () => {
    it("holds the answer when the user steps back", () => {
      watchSessionActivity(SESSION);
      activity("busy");

      // Task 4's rule: a silent session going busy takes the body.
      expect(handedOver()).toBe(true);

      holdAnswer(SESSION);

      // ...and the user asking for the text outranks it.
      expect(handedOver()).toBe(false);

      // The hold is the SESSION's state and goes with the session. Destroying it
      // runs through `forgetAnswerWaiting` — `destroyTerminal` calls exactly
      // that, which `answerWaiting.activity.test.ts` pins — so a session watched
      // again afterwards is a session that is not still holding.
      forgetAnswerWaiting(SESSION);
      watchSessionActivity(SESSION);
      // A watch that opens on an already-busy session gets a window like any
      // other busy spell — "busy when we looked" is exactly the reading the
      // debounce distrusts — so the spell has to be established here too.
      vi.advanceTimersByTime(DEBOUNCE);

      expect(handedOver()).toBe(true);
    });

    it("keeps holding it across further activity while the session stays busy", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      // A re-broadcast of the state the session is already in is a reading, not
      // a transition — and the transition is the only thing that decides here.
      activity("busy");
      expect(handedOver()).toBe(false);

      // Nor does the voice starting and stopping. The deferral is about taking
      // the body; the hold is about keeping it, and playback settles neither.
      noteSpeaking(SESSION, true);
      expect(handedOver()).toBe(false);
      noteSpeaking(SESSION, false);
      expect(handedOver()).toBe(false);
    });

    it("releases on a forward step", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      releaseAnswer(SESSION);

      // Stepping forward gives the agent the body back, because the agent is
      // still working and the user has said they are done re-reading.
      expect(handedOver()).toBe(true);

      // Releasing a hold nobody set is a no-op, not a handover in reverse.
      releaseAnswer(SESSION);
      expect(handedOver()).toBe(true);
    });

    it("releases when a new answer arrives", () => {
      watchSessionActivity(SESSION);

      // The surface's baseline: the newest answer the cell already holds. There
      // is no hold to release, so there is nothing to tell it.
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);

      activity("busy");
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      // A re-render pushing the same id is not an arrival.
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
      expect(handedOver()).toBe(false);

      // A genuinely new answer. `true` is the surface's cue to put its cursor
      // back on the newest answer — the one part of this the module cannot do
      // for itself, because it owns no cursor and may not reach for one.
      expect(noteNewestAnswer(SESSION, "u-2")).toBe(true);

      // The hold is gone, and the body renders the answer the surface just
      // snapped to AT ONCE, busy or not: an arriving answer is the agent
      // stopping (ADR 0018), so there is no agent claim left for the release to
      // hand the body back to.
      expect(handedOver()).toBe(false);
      activity("idle");
      expect(handedOver()).toBe(false);

      // With no hold standing, a further arrival releases nothing and asks the
      // surface for no snap: the reader's place is only ever taken deliberately.
      expect(noteNewestAnswer(SESSION, "u-3")).toBe(false);
    });

    it("a send releases a standing hold", () => {
      watchSessionActivity(SESSION);

      // The most ordinary path there is once the *Previous* button sets the
      // hold: the agent is idle, the user steps back to re-read, and then types
      // a reply and presses Enter.
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      beginWaiting(SESSION, "u-1");

      // Task 4's contract, which the hold does not get to overrule: a sent draft
      // hands the body over at once, speaking or not. A hold left standing here
      // would answer the send with MARK_ONLY — the OLD answer on the body and no
      // wave — for the entire reply.
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });

      // And it is released, not merely outranked: the agent picking the work up
      // must not find the pane pinned again by a press made before the send.
      activity("busy");
      expect(handedOver()).toBe(true);
    });

    it("treats the first push of a newest answer as seeding, not an arrival", () => {
      watchSessionActivity(SESSION);
      activity("busy");

      // `holdAnswer` creates the entry, so at this point nothing has ever told
      // it which answer is newest. The first push is the surface saying where it
      // stands, not an answer landing — reading it as an arrival would drop the
      // hold on the very frame the user made it, which is the failure the seam
      // exists to avoid.
      holdAnswer(SESSION);
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
      expect(handedOver()).toBe(false);

      // The next genuinely different id IS the arrival — and, being the agent
      // stopping (ADR 0018), it hands the body to that answer while still busy.
      expect(noteNewestAnswer(SESSION, "u-2")).toBe(true);
      expect(handedOver()).toBe(false);
    });

    it("releases on an answer that lands in `pending` while the voice is reading", () => {
      // Task 1's queue, as far as this seam cares: an arrival while the voice is
      // reading takes the `speaking: true` arm, which appends to `pending` and
      // leaves `current` exactly where it was. So the id the surface pushes must
      // be the newest answer the cell HOLDS — `pending.at(-1)?.id ?? current?.id`
      // — and never `current?.id` alone, which does not move here at all.
      const queue: { current: { id: string } | null; pending: { id: string }[] } = {
        current: { id: "u-1" },
        pending: [],
      };
      const arrivedWhileSpeaking = (id: string): void => {
        queue.pending = [...queue.pending, { id }];
      };
      const newestId = (): string | null => queue.pending.at(-1)?.id ?? queue.current?.id ?? null;

      watchSessionActivity(SESSION);
      expect(noteNewestAnswer(SESSION, newestId())).toBe(false);

      // Busy and mid-sentence — the exact situation the hold exists for.
      activity("busy");
      noteSpeaking(SESSION, true);
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      arrivedWhileSpeaking("u-2");

      // `current` has not moved. Keyed on it, this arrival would be invisible and
      // the hold would stand through the whole reply.
      expect(queue.current?.id).toBe("u-1");
      expect(noteNewestAnswer(SESSION, newestId())).toBe(true);
      // Released onto the answer, not onto the wave: the arrival ended the busy
      // spell (ADR 0018).
      expect(handedOver()).toBe(false);
    });

    it("releases when the session goes idle", () => {
      watchSessionActivity(SESSION);
      activity("busy");
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      activity("idle");

      // Idle shows the answer either way, so the interesting half is whether the
      // hold survived: it must not, or the next thing the agent does would find
      // the pane pinned by a press the user made against work that is over.
      expect(handedOver()).toBe(false);
      activity("busy");
      expect(handedOver()).toBe(true);
    });

    it("tells its subscribers when the hold moves under an unchanged snapshot", () => {
      watchSessionActivity(SESSION);

      // Busy MID-SENTENCE: the handover is deferred, so the body keeps the
      // answer — and keeps it whether or not a hold is standing. `derive` has
      // one answer for both, which makes this the one configuration where the
      // hold can move without the snapshot moving with it.
      noteSpeaking(SESSION, true);
      activity("busy");
      expect(handedOver()).toBe(false);

      const settled = getAnswerWaiting(SESSION);
      let told = 0;
      const stop = subscribeAnswerWaiting(() => {
        told += 1;
      });

      // The hold is read through the SAME listener set as the snapshot — it is
      // what draws the *Next answer* control — so a hold change that notifies
      // nobody is a control that nobody can see appear, and, worse, one that
      // cannot be seen to respond when it is pressed.
      holdAnswer(SESSION);
      expect(getAnswerWaiting(SESSION)).toBe(settled);
      expect(isAnswerHeld(SESSION)).toBe(true);
      expect(told).toBe(1);

      releaseAnswer(SESSION);
      expect(getAnswerWaiting(SESSION)).toBe(settled);
      expect(isAnswerHeld(SESSION)).toBe(false);
      expect(told).toBe(2);

      // The arrival release takes the same way out, and has the same unchanged
      // snapshot on either side of it.
      holdAnswer(SESSION);
      expect(told).toBe(3);
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
      expect(noteNewestAnswer(SESSION, "u-2")).toBe(true);
      expect(isAnswerHeld(SESSION)).toBe(false);
      expect(told).toBe(4);

      // A hold that did not move tells nobody anything: the guards on both entry
      // points stay guards.
      releaseAnswer(SESSION);
      expect(told).toBe(4);

      stop();
    });

    it("schedules no timer to release the hold", () => {
      watchSessionActivity(SESSION);
      const timeout = vi.spyOn(globalThis, "setTimeout");
      const interval = vi.spyOn(globalThis, "setInterval");

      activity("busy");
      holdAnswer(SESSION);
      expect(handedOver()).toBe(false);

      // The one clock in the module is the debounce the busy transition opens,
      // and it guards the way IN. Everything below is about the hold, which is
      // the way out — so the spy is cleared here and must stay silent for the
      // rest of the drive.
      expect(timeout.mock.calls.map(([, delay]) => delay)).toEqual([DEBOUNCE]);
      expect(interval).not.toHaveBeenCalled();
      timeout.mockClear();

      // ...and ten minutes of clock changes nothing. The session is still busy
      // and the user has not stepped forward, so the only things that could end
      // this have not happened.
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(handedOver()).toBe(false);
      vi.runOnlyPendingTimers();
      expect(handedOver()).toBe(false);

      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();

      // The claim is about the RELEASING side too, so every way out of a hold is
      // driven under the same spies rather than only the way in.
      releaseAnswer(SESSION);
      expect(handedOver()).toBe(true);

      holdAnswer(SESSION);
      expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
      expect(noteNewestAnswer(SESSION, "u-2")).toBe(true);
      // The arrival ends the busy spell too (ADR 0018), so the body is the
      // answer's — and, the point of this test, no timer was scheduled for it.
      expect(handedOver()).toBe(false);

      holdAnswer(SESSION);
      beginWaiting(SESSION, "u-2");
      expect(handedOver()).toBe(true);

      holdAnswer(SESSION);
      activity("idle");
      expect(handedOver()).toBe(false);

      vi.advanceTimersByTime(10 * 60 * 1000);
      vi.runOnlyPendingTimers();

      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    });
  });
});
