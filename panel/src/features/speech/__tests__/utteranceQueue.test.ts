import { describe, expect, it } from "vitest";
import type { Utterance } from "../types";
import {
  MAX_PENDING,
  emptyUtteranceQueue,
  utteranceQueueReducer,
  utteranceUnderCursor,
} from "../utteranceQueue";
import type { UtteranceQueue } from "../utteranceQueue";

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
 * reducer — the state object, its list, and the utterances inside it.
 *
 * In place is the load-bearing half. A version that froze a *copy* handed the
 * reducer something the caller no longer held, so the "never mutates" snapshot
 * below could not fail however the reducer wrote to its argument; and a shallow
 * freeze let `state.current.text = …` through in silence.
 */
const frozen = (state: UtteranceQueue): UtteranceQueue => {
  for (const utterance of [state.previous, state.current, ...state.pending]) {
    if (utterance) Object.freeze(utterance);
  }
  Object.freeze(state.pending);
  return Object.freeze(state);
};

const arrive = (state: UtteranceQueue, utterance: Utterance, speaking: boolean): UtteranceQueue =>
  utteranceQueueReducer(frozen(state), { type: "arrived", utterance, speaking });

/** A speaking cell holding `answer(0)` with `count` answers waiting behind it. */
const withPending = (count: number): UtteranceQueue => {
  let state = arrive(emptyUtteranceQueue, answer(0), false);
  for (let n = 1; n <= count; n += 1) state = arrive(state, answer(n), true);
  return state;
};

describe("utteranceQueueReducer", () => {
  it("an utterance arriving idle becomes current", () => {
    const state = arrive(emptyUtteranceQueue, answer(1), false);

    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([]);
    expect(state.previous).toBeNull();
    expect(state.cursor).toBe("current");
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

    expect(state.previous).toEqual(answer(0));
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
    expect(state.cursor).toBe("current");
  });

  it("finishing with an empty queue leaves current null", () => {
    const state = utteranceQueueReducer(frozen(withPending(0)), { type: "finished" });

    expect(state.previous).toEqual(answer(0));
    expect(state.current).toBeNull();
    expect(state.pending).toEqual([]);
  });

  it("previous is one step deep and a second press is a no-op", () => {
    const finished = utteranceQueueReducer(frozen(withPending(1)), { type: "finished" });

    const back = utteranceQueueReducer(frozen(finished), { type: "previous" });
    expect(back.cursor).toBe("previous");
    expect(back.previous).toEqual(answer(0));
    expect(back.current).toEqual(answer(1));

    const again = utteranceQueueReducer(back, { type: "previous" });
    expect(again).toBe(back);
  });

  it("next returns the cursor from previous to current", () => {
    const finished = utteranceQueueReducer(frozen(withPending(1)), { type: "finished" });
    const back = utteranceQueueReducer(frozen(finished), { type: "previous" });

    const forward = utteranceQueueReducer(frozen(back), { type: "next" });

    expect(forward.cursor).toBe("current");
    expect(forward.previous).toEqual(answer(0));
    expect(forward.current).toEqual(answer(1));
    expect(forward.pending).toEqual([]);
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

    expect(state.previous).toEqual(answer(1));
    expect(state.current).toEqual(answer(2));
    expect(state.pending).toEqual([]);
    expect(state.cursor).toBe("current");
  });

  it("next skips into pending when the cursor is on current", () => {
    const state = utteranceQueueReducer(frozen(withPending(2)), { type: "next" });

    expect(state.previous).toEqual(answer(0));
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
  });

  /**
   * The dangerous one. `finished` fires from the player's natural end, and a
   * replay of `previous` ends naturally too — so when the cursor sits in
   * history the event means "the replay is over", never "move the list on".
   * Shifting there would push the **unheard** `current` into `previous` and
   * hand the cell the utterance after it: the answer the user was waiting for,
   * silently skipped. It is also what the host's auto-advance leans on.
   */
  it("finishing a replay returns the cursor without shifting the queue", () => {
    const advanced = utteranceQueueReducer(frozen(withPending(2)), { type: "finished" });
    const replaying = utteranceQueueReducer(frozen(advanced), { type: "previous" });
    // Fixture guard: a replay, with something unheard in `current` and
    // something waiting behind it — so a shift would be visible twice over.
    expect(replaying.cursor).toBe("previous");
    expect(replaying.current).toEqual(answer(1));
    expect(replaying.pending).toEqual([answer(2)]);

    const state = utteranceQueueReducer(frozen(replaying), { type: "finished" });

    expect(state.cursor).toBe("current");
    expect(state.previous).toEqual(answer(0));
    expect(state.current).toEqual(answer(1));
    expect(state.pending).toEqual([answer(2)]);
  });

  it("finishing discards the utterance already in previous", () => {
    // One step deep by decision: the slot holds the answer before the one that
    // just finished, and the one before THAT is gone. Reached from a state
    // whose `previous` is already occupied, which is the only way the discard
    // is observable at all.
    const advanced = utteranceQueueReducer(frozen(withPending(2)), { type: "finished" });
    expect(advanced.previous).toEqual(answer(0));

    const state = utteranceQueueReducer(frozen(advanced), { type: "finished" });

    expect(state.previous).toEqual(answer(1));
    expect(state.current).toEqual(answer(2));
    expect(state.pending).toEqual([]);
  });

  it("an arrival on a finished cell keeps the last answer as history", () => {
    // Everything played out: `current` is empty and the last answer is the one
    // step of history. The arrival must not take that step away — `previous` is
    // what the transport walks back to, and the newest answer is exactly when a
    // listener reaches for it.
    const played = utteranceQueueReducer(frozen(withPending(0)), { type: "finished" });
    expect(played.current).toBeNull();
    expect(played.previous).toEqual(answer(0));

    const state = arrive(played, answer(1), false);

    expect(state.previous).toEqual(answer(0));
    expect(state.current).toEqual(answer(1));
    expect(state.cursor).toBe("current");
  });

  it("an arrival while speaking leaves the cursor in history alone", () => {
    const advanced = utteranceQueueReducer(frozen(withPending(1)), { type: "finished" });
    const replaying = utteranceQueueReducer(frozen(advanced), { type: "previous" });
    expect(replaying.cursor).toBe("previous");

    // A new answer landing mid-replay is news for the queue, never a reason to
    // yank the listener out of the message being replayed.
    const state = arrive(replaying, answer(9), true);

    expect(state.cursor).toBe("previous");
    expect(state.previous).toEqual(answer(0));
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
    expect(Object.isFrozen(emptyUtteranceQueue.pending)).toBe(true);
  });

  it("returns the same state object for every no-op event", () => {
    const idle = arrive(emptyUtteranceQueue, answer(1), false);

    // Nothing behind the cursor, nothing ahead of it, nothing to finish.
    expect(utteranceQueueReducer(idle, { type: "previous" })).toBe(idle);
    expect(utteranceQueueReducer(idle, { type: "next" })).toBe(idle);
    expect(utteranceQueueReducer(emptyUtteranceQueue, { type: "finished" })).toBe(
      emptyUtteranceQueue,
    );
    expect(utteranceQueueReducer(emptyUtteranceQueue, { type: "next" })).toBe(emptyUtteranceQueue);
  });

  it("never mutates the state it is given", () => {
    const before = withPending(2);
    const snapshot = JSON.parse(JSON.stringify(before)) as UtteranceQueue;

    utteranceQueueReducer(frozen(before), { type: "finished" });
    utteranceQueueReducer(frozen(before), { type: "previous" });
    utteranceQueueReducer(frozen(before), { type: "next" });
    utteranceQueueReducer(frozen(before), { type: "arrived", utterance: answer(9), speaking: true });

    expect(before).toEqual(snapshot);
  });
});
