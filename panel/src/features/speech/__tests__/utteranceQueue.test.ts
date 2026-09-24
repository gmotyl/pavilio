import { describe, expect, it } from "vitest";
import type { Utterance } from "../types";
import {
  MAX_PENDING,
  MAX_PREVIOUS,
  emptyUtteranceQueue,
  utteranceQueueReducer,
  utteranceUnderCursor,
} from "../utteranceQueue";
import type { UtteranceQueue, UtteranceQueueEvent } from "../utteranceQueue";

/**
 * The queue holds **whole agent responses**. Every fixture here is one finished
 * answer (or one question the agent is parked on) — never a fragment of one,
 * which is a speech unit and belongs to the scrubber, not to this file.
 */
const answer = (n: number): Utterance => ({
  id: `u${n}`,
  sessionId: "cell-1",
  text: `Answer number ${n}.`,
  at: 1_700_000_000_000 + n,
});

/**
 * Deep-freeze **in place**, so any mutation of the input state throws in the
 * reducer — the state object, both its lists, and the utterances inside them.
 *
 * In place is the load-bearing half. A version that froze a *copy* handed the
 * reducer something the caller no longer held, so the "never mutates" snapshot
 * below could not fail however the reducer wrote to its argument; and a shallow
 * freeze let `state.current.text = …` through in silence.
 */
const frozen = (state: UtteranceQueue): UtteranceQueue => {
  for (const utterance of [...state.previous, state.current, ...state.pending]) {
    if (utterance) Object.freeze(utterance);
  }
  Object.freeze(state.previous);
  Object.freeze(state.pending);
  return Object.freeze(state);
};

const arrive = (state: UtteranceQueue, utterance: Utterance, speaking: boolean): UtteranceQueue =>
  utteranceQueueReducer(frozen(state), { type: "arrived", utterance, speaking });

/**
 * The three events that carry no payload, one ready-made object each. Named
 * rather than built from a string at the call site: `{ type }` where `type` is
 * the union of their names is not assignable to the event union — a value of
 * that shape could be any one of the three, and the compiler will not pick for
 * us — and the honest way past that is to hand back an event that IS one of
 * them, not to assert one into being.
 */
const PRESSES = {
  finished: { type: "finished" },
  previous: { type: "previous" },
  next: { type: "next" },
} as const satisfies Record<string, UtteranceQueueEvent>;

/** The same transport press, `times` over, each on a frozen input. */
const press = (
  state: UtteranceQueue,
  times: number,
  type: keyof typeof PRESSES,
): UtteranceQueue => {
  let walked = state;
  for (let n = 0; n < times; n += 1) walked = utteranceQueueReducer(frozen(walked), PRESSES[type]);
  return walked;
};

/** A speaking cell holding `answer(0)` with `count` answers waiting behind it. */
const withPending = (count: number): UtteranceQueue => {
  let state = arrive(emptyUtteranceQueue, answer(0), false);
  for (let n = 1; n <= count; n += 1) state = arrive(state, answer(n), true);
  return state;
};

/**
 * `count` answers arriving on an idle cell, one superseding the next: the last
 * is `current` and the ones before it are the history, newest first.
 */
const withHistory = (count: number): UtteranceQueue => {
  let state = emptyUtteranceQueue;
  for (let n = 1; n <= count; n += 1) state = arrive(state, answer(n), false);
  return state;
};

describe("utteranceQueueReducer", () => {
  it("an utterance arriving idle becomes current", () => {
    const state = arrive(emptyUtteranceQueue, answer(1), false);

    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([]);
    expect(state.previous).toEqual([]);
    expect(state.cursor).toBe(0);
  });

  it("an utterance arriving mid-playback is queued", () => {
    const speaking = arrive(emptyUtteranceQueue, answer(1), false);

    const state = arrive(speaking, answer(2), true);

    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
  });

  it("queueing a sixth drops the oldest pending", () => {
    const state = arrive(withPending(MAX_PENDING), answer(MAX_PENDING + 1), true);

    expect(MAX_PENDING).toBe(5);
    expect(state.pending).toHaveLength(MAX_PENDING);
    expect(state.pending.map((u) => u.id)).toEqual(["u2", "u3", "u4", "u5", "u6"]);
    expect(state.current).toEqual(answer(0));
  });

  it("finishing advances pending into current and current into previous", () => {
    const state = utteranceQueueReducer(frozen(withPending(2)), { type: "finished" });

    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
    expect(state.cursor).toBe(0);
  });

  it("finishing with an empty queue leaves current null", () => {
    const state = utteranceQueueReducer(frozen(withPending(0)), { type: "finished" });

    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toBeNull();
    expect(state.pending).toEqual([]);
  });

  it("walks back through five answers of history", () => {
    // Six answers, five of them superseded: the history is full and `current`
    // is the newest. Each press is one step further back, so three presses land
    // on the third-most-recent answer the history holds.
    const state = withHistory(MAX_PREVIOUS + 1);
    expect(MAX_PREVIOUS).toBe(5);
    expect(state.previous).toHaveLength(MAX_PREVIOUS);
    expect(state.previous.map((u) => u.id)).toEqual(["u5", "u4", "u3", "u2", "u1"]);

    const back = press(state, 3, "previous");

    expect(back.cursor).toBe(3);
    expect(utteranceUnderCursor(back)).toEqual(answer(3));
    // Walking the cursor never moves the answers themselves.
    expect(back.current).toEqual(answer(6));
    expect(back.previous).toEqual(state.previous);
  });

  it("drops the oldest answer when the history is full", () => {
    const state = withHistory(MAX_PREVIOUS + 2);

    expect(state.previous).toHaveLength(MAX_PREVIOUS);
    expect(state.previous.map((u) => u.id)).toEqual(["u6", "u5", "u4", "u3", "u2"]);
    expect(state.current).toEqual(answer(7));
  });

  it("clamps the cursor to the oldest answer still held when its own falls off the end", () => {
    // The one case the walk-back tests cannot reach: the cursor is parked on the
    // very oldest answer of a FULL history when a new one arrives idle. Tracking
    // the cursor's own utterance would step it one further back, but there is no
    // further back to step to — the answer it was on has just been pushed off the
    // end to make room. Clamping is what keeps the transport on a real answer
    // instead of on an index past the list, which reads back as nothing at all
    // and would strand a listener on a silent cell.
    const full = withHistory(MAX_PREVIOUS + 1);
    const parked = press(full, MAX_PREVIOUS, "previous");
    // Fixture guard: a full history, and the cursor on its last answer.
    expect(parked.previous.map((u) => u.id)).toEqual(["u5", "u4", "u3", "u2", "u1"]);
    expect(parked.cursor).toBe(MAX_PREVIOUS);
    expect(utteranceUnderCursor(parked)).toEqual(answer(1));

    const state = arrive(parked, answer(MAX_PREVIOUS + 2), false);

    expect(state.previous.map((u) => u.id)).toEqual(["u6", "u5", "u4", "u3", "u2"]);
    expect(state.cursor).toBe(MAX_PREVIOUS);
    // Not `answer(1)` — that one is gone — and emphatically not nothing.
    expect(utteranceUnderCursor(state)).toEqual(answer(2));
  });

  it("returns to where it started after going back and forward the same number of steps", () => {
    const state = withHistory(4);
    const started = utteranceUnderCursor(state);

    const round = press(press(state, 2, "previous"), 2, "next");

    expect(round.cursor).toBe(0);
    expect(utteranceUnderCursor(round)).toBe(started);
    expect(round.previous).toEqual(state.previous);
    expect(round.pending).toEqual(state.pending);
  });

  it("next steps exactly one answer forward, from the middle of the history", () => {
    // The round trip above starts and ends on `current`, so it cannot tell a
    // symmetric walk from a jump straight home: a `next` that collapsed the
    // cursor to 0 in one press would satisfy it just as well. Asserted from the
    // middle of the history instead, where the two differ — the transport is a
    // walk, one answer per press in either direction, and a listener stepping
    // forward out of a deep replay must not be thrown past everything between.
    const state = press(withHistory(5), 3, "previous");
    // Fixture guard: mid-history, with answers on BOTH sides of the cursor.
    expect(state.cursor).toBe(3);
    expect(state.previous).toHaveLength(4);
    expect(utteranceUnderCursor(state)).toEqual(answer(2));

    const forward = press(state, 1, "next");

    expect(forward.cursor).toBe(2);
    expect(utteranceUnderCursor(forward)).toEqual(answer(3));
    // And the press after it is one more step, not the rest of the way home.
    expect(press(forward, 1, "next").cursor).toBe(1);
  });

  it("stops at the oldest answer rather than falling off the end", () => {
    const oldest = press(withHistory(3), 2, "previous");
    expect(oldest.cursor).toBe(oldest.previous.length);
    expect(utteranceUnderCursor(oldest)).toEqual(answer(1));

    // No room left behind the cursor, so the press is a genuine no-op.
    expect(utteranceQueueReducer(oldest, { type: "previous" })).toBe(oldest);
  });

  it("stops at the newest answer rather than falling off the front", () => {
    const newest = withHistory(3);
    expect(newest.cursor).toBe(0);
    expect(newest.pending).toEqual([]);

    expect(utteranceQueueReducer(newest, { type: "next" })).toBe(newest);
  });

  it("keeps the cursor on its utterance when a new answer arrives behind it", () => {
    const back = press(withHistory(3), 2, "previous");
    expect(utteranceUnderCursor(back)).toEqual(answer(1));

    // Queued behind a live run: the history does not move, so neither does the
    // cursor's index.
    const queued = arrive(back, answer(8), true);
    expect(utteranceUnderCursor(queued)).toEqual(answer(1));
    expect(queued.pending).toEqual([answer(8)]);

    // An idle arrival pushes `current` into the history, so the index has to
    // move by one to stay on the very same answer.
    const superseded = arrive(back, answer(9), false);
    expect(superseded.current).toEqual(answer(9));
    expect(utteranceUnderCursor(superseded)).toEqual(answer(1));
  });

  it("previous with no history returns the same state", () => {
    const idle = arrive(emptyUtteranceQueue, answer(1), false);

    expect(utteranceQueueReducer(idle, { type: "previous" })).toBe(idle);
    expect(utteranceQueueReducer(emptyUtteranceQueue, { type: "previous" })).toBe(
      emptyUtteranceQueue,
    );
  });

  it("an idle arrival moves the superseded utterance into previous", () => {
    const idle = arrive(emptyUtteranceQueue, answer(1), false);

    const state = arrive(idle, answer(2), false);

    expect(state.previous).toEqual([answer(1)]);
    expect(state.current).toEqual(answer(2));
    expect(state.pending).toEqual([]);
    expect(state.cursor).toBe(0);
  });

  it("next skips into pending when the cursor is on current", () => {
    const state = utteranceQueueReducer(frozen(withPending(2)), { type: "next" });

    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
  });

  /**
   * The dangerous one. `finished` fires from the player's natural end, and a
   * replay out of the history ends naturally too — so when the cursor sits in
   * history the event means "the replay is over", never "move the list on".
   * Shifting there would push the **unheard** `current` into the history and
   * hand the cell the utterance after it: the answer the user was waiting for,
   * silently skipped. It is also what the host's auto-advance leans on.
   */
  it("finishing a replay returns the cursor without shifting the queue", () => {
    const advanced = utteranceQueueReducer(frozen(withPending(2)), { type: "finished" });
    const replaying = utteranceQueueReducer(frozen(advanced), { type: "previous" });
    // Fixture guard: a replay, with something unheard in `current` and
    // something waiting behind it — so a shift would be visible twice over.
    expect(replaying.cursor).toBe(1);
    expect(replaying.current).toEqual(answer(1));
    expect(replaying.pending).toEqual([answer(2)]);

    const state = utteranceQueueReducer(frozen(replaying), { type: "finished" });

    expect(state.cursor).toBe(0);
    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
  });

  it("finishing keeps the answers already in the history", () => {
    // Five steps deep now: the answer before the one that just finished stays
    // reachable rather than being discarded to make room for it. Reached from a
    // state whose history is already occupied, which is the only way the
    // difference is observable at all.
    const advanced = utteranceQueueReducer(frozen(withPending(2)), { type: "finished" });
    expect(advanced.previous).toEqual([answer(0)]);

    const state = utteranceQueueReducer(frozen(advanced), { type: "finished" });

    expect(state.previous).toEqual([answer(1), answer(0)]);
    expect(state.current).toEqual(answer(2));
    expect(state.pending).toEqual([]);
  });

  it("an arrival on a finished cell keeps the last answer as history", () => {
    // Everything played out: `current` is empty and the last answer is the head
    // of the history. The arrival must not take that step away — the history is
    // what the transport walks back into, and the newest answer is exactly when
    // a listener reaches for it.
    const played = utteranceQueueReducer(frozen(withPending(0)), { type: "finished" });
    expect(played.current).toBeNull();
    expect(played.previous).toEqual([answer(0)]);

    const state = arrive(played, answer(1), false);

    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toEqual(answer(1));
    expect(state.cursor).toBe(0);
  });

  it("an arrival while speaking leaves the cursor in history alone", () => {
    const advanced = utteranceQueueReducer(frozen(withPending(1)), { type: "finished" });
    const replaying = utteranceQueueReducer(frozen(advanced), { type: "previous" });
    expect(replaying.cursor).toBe(1);

    // A new answer landing mid-replay is news for the queue, never a reason to
    // yank the listener out of the message being replayed.
    const state = arrive(replaying, answer(9), true);

    expect(state.cursor).toBe(1);
    expect(state.previous).toEqual([answer(0)]);
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(9)]);
  });

  it("names the utterance the transport is on, whichever side of the cursor", () => {
    const advanced = utteranceQueueReducer(frozen(withPending(1)), { type: "finished" });
    expect(utteranceUnderCursor(advanced)).toEqual(answer(1));

    const replaying = utteranceQueueReducer(frozen(advanced), { type: "previous" });
    expect(utteranceUnderCursor(replaying)).toEqual(answer(0));

    expect(utteranceUnderCursor(emptyUtteranceQueue)).toBeNull();
  });

  it("the empty queue is frozen, so no cell can poison every other cell", () => {
    // A module singleton handed out as every cell's initial state.
    expect(Object.isFrozen(emptyUtteranceQueue)).toBe(true);
    expect(Object.isFrozen(emptyUtteranceQueue.previous)).toBe(true);
    expect(Object.isFrozen(emptyUtteranceQueue.pending)).toBe(true);
  });

  it("returns the same reference for an event that changes nothing", () => {
    const idle = arrive(emptyUtteranceQueue, answer(1), false);

    // Nothing behind the cursor, nothing ahead of it, nothing to finish.
    expect(utteranceQueueReducer(idle, { type: "previous" })).toBe(idle);
    expect(utteranceQueueReducer(idle, { type: "next" })).toBe(idle);
    expect(utteranceQueueReducer(emptyUtteranceQueue, { type: "finished" })).toBe(
      emptyUtteranceQueue,
    );
    expect(utteranceQueueReducer(emptyUtteranceQueue, { type: "next" })).toBe(emptyUtteranceQueue);

    // And at either end of a history deep enough to walk.
    const oldest = press(withHistory(3), 2, "previous");
    expect(utteranceQueueReducer(oldest, { type: "previous" })).toBe(oldest);
    const newest = withHistory(3);
    expect(utteranceQueueReducer(newest, { type: "next" })).toBe(newest);
  });

  it("never mutates the state it was given", () => {
    const before = withHistory(3);
    const snapshot = JSON.parse(JSON.stringify(before)) as UtteranceQueue;

    utteranceQueueReducer(frozen(before), { type: "finished" });
    utteranceQueueReducer(frozen(before), { type: "previous" });
    utteranceQueueReducer(frozen(before), { type: "next" });
    utteranceQueueReducer(frozen(before), { type: "arrived", utterance: answer(9), speaking: true });
    utteranceQueueReducer(frozen(before), {
      type: "arrived",
      utterance: answer(9),
      speaking: false,
    });

    expect(before).toEqual(snapshot);

    // The same, from a cursor parked in the history and a queue with a backlog.
    const replaying = press(withPending(2), 1, "finished");
    const walked = press(replaying, 1, "previous");
    const walkedSnapshot = JSON.parse(JSON.stringify(walked)) as UtteranceQueue;

    utteranceQueueReducer(frozen(walked), { type: "previous" });
    utteranceQueueReducer(frozen(walked), { type: "next" });
    utteranceQueueReducer(frozen(walked), { type: "finished" });
    utteranceQueueReducer(frozen(walked), { type: "arrived", utterance: answer(9), speaking: true });

    expect(walked).toEqual(walkedSnapshot);
  });
});
