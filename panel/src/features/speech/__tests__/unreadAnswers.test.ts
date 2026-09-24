import { describe, expect, it } from "vitest";
import type { Utterance } from "../types";
import { MAX_PENDING, MAX_PREVIOUS, emptyUtteranceQueue } from "../utteranceQueue";
import type { UtteranceQueue } from "../utteranceQueue";
import { unreadAnswerCount } from "../unreadAnswers";

/**
 * Every fixture here is one whole agent response — the unit the queue counts.
 * A count over speech units would be a count of paragraphs, which is the
 * scrubber's business and not this file's.
 */
const answer = (n: number): Utterance => ({
  id: `u${n}`,
  sessionId: "cell-1",
  text: `Answer number ${n}.`,
  at: 1_700_000_000_000 + n,
});

/**
 * A queue written out slot by slot rather than replayed through the reducer.
 * The count is a derivation over the shape, so the shape is what the tests
 * should be free to state — including the corners the reducer takes several
 * events to reach, such as a history and a pending list that are both full.
 */
const queueOf = (parts: Partial<UtteranceQueue>): UtteranceQueue => ({
  ...emptyUtteranceQueue,
  ...parts,
});

const heardOf = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe("unreadAnswerCount", () => {
  it("counts the answers that have never been played", () => {
    const queue = queueOf({
      previous: [answer(3), answer(2)],
      current: answer(4),
      pending: [answer(5)],
    });

    expect(unreadAnswerCount(queue, heardOf("u2"))).toBe(3);
  });

  it("counts nothing when everything reachable has been played", () => {
    const queue = queueOf({
      previous: [answer(2)],
      current: answer(3),
      pending: [answer(4)],
    });

    expect(unreadAnswerCount(queue, heardOf("u2", "u3", "u4"))).toBe(0);
  });

  it("drops by one when an answer is played", () => {
    const queue = queueOf({
      previous: [answer(2)],
      current: answer(3),
      pending: [answer(4)],
    });

    const before = unreadAnswerCount(queue, heardOf("u2"));

    expect(unreadAnswerCount(queue, heardOf("u2", "u3"))).toBe(before - 1);
  });

  it("ignores heard ids the queue can no longer reach", () => {
    const queue = queueOf({ current: answer(9) });

    // Three answers played long ago and since pushed off the far end of the
    // history: they are no longer answers the listener can be shown, so they
    // are neither counted nor allowed to cancel out anything that is.
    expect(unreadAnswerCount(queue, heardOf("u1", "u2", "u3"))).toBe(1);
  });

  it("tops out at the reachable ceiling", () => {
    const ceiling = MAX_PREVIOUS + 1 + MAX_PENDING;
    const queue = queueOf({
      previous: Array.from({ length: MAX_PREVIOUS }, (_, index) => answer(index)),
      current: answer(100),
      pending: Array.from({ length: MAX_PENDING }, (_, index) => answer(200 + index)),
    });

    expect(ceiling).toBe(11);
    expect(unreadAnswerCount(queue, new Set())).toBe(ceiling);
  });

  it("counts an answer held in two slots once", () => {
    // The channel's own dedupe should keep this out of a real queue, but the
    // count is keyed on the id and so is `heard`: playing the answer once
    // would clear both copies, so counting it twice promises a step back the
    // listener can never take.
    const repeated = answer(7);
    const queue = queueOf({ previous: [repeated], current: repeated });

    expect(unreadAnswerCount(queue, new Set())).toBe(1);
  });

  it("counts nothing for an empty cell", () => {
    expect(unreadAnswerCount(emptyUtteranceQueue, new Set())).toBe(0);
  });
});
