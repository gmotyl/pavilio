import { describe, expect, it } from "vitest";
import type { Utterance } from "../types";
import { MAX_PENDING, emptyUtteranceQueue, utteranceQueueReducer } from "../utteranceQueue";
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

/** Deep-freeze, so any mutation of the input state throws in the reducer. */
const frozen = (state: UtteranceQueue): UtteranceQueue =>
  Object.freeze({ ...state, pending: Object.freeze([...state.pending]) as Utterance[] });

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
