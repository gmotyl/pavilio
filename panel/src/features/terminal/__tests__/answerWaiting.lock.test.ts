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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Anything the hold could reach for on the speech side, recorded per access. */
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

import {
  __resetAnswerWaitingForTests,
  beginWaiting,
  forgetAnswerWaiting,
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteNewestAnswer,
  noteSpeaking,
  releaseAnswer,
  subscribeAnswerWaiting,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** The body's handover, as the pane reads it. */
const handedOver = (sessionId = SESSION): boolean => getAnswerWaiting(sessionId).waiting;

/** The debounce window these tests run under, pinned on the boot document. */
const DEBOUNCE = 3000;

/**
 * An activity broadcast for the cell, as the server sends it — and, for a busy
 * one, the debounce window that broadcast opens. The hold is a claim about an
 * ESTABLISHED busy spell ("the agent has the body and the user wants the text
 * back"), so every criterion here wants the spell the window already allowed;
 * the window itself is pinned in `answerWaiting.debounce.test.ts`.
 */
let at = 0;
const activity = (state: "idle" | "busy" | "attention", sessionId = SESSION): void => {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
  if (state === "busy") vi.advanceTimersByTime(DEBOUNCE);
};

beforeEach(() => {
  at = 0;
  speechReach.length = 0;
  _resetForTests();
  __resetAnswerWaitingForTests();
  // The debounce is a clock, so the whole file runs on a controlled one.
  vi.useFakeTimers();
  (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__ = {
    answerWaveDebounceMs: DEBOUNCE,
  };
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useRealTimers();
  delete (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
  // The module's one standing discipline, asserted after every drive in this
  // file rather than in a test of its own: a hold that reached for the queue,
  // the player, the channel or the host would show up here.
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

    // The hold is gone. The session is still busy, so the body is the agent's
    // again — Task 4's rule, which this task was told not to change — and the
    // answer the surface just snapped to is what the body renders the moment
    // the agent stops.
    expect(handedOver()).toBe(true);
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

    // The next genuinely different id IS the arrival.
    expect(noteNewestAnswer(SESSION, "u-2")).toBe(true);
    expect(handedOver()).toBe(true);
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
    expect(handedOver()).toBe(true);
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
    expect(handedOver()).toBe(true);

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
