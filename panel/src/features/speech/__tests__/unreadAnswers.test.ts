import { describe, expect, it } from "vitest";
import type { Utterance } from "../types";
import { MAX_PENDING, MAX_PREVIOUS, emptyUtteranceQueue } from "../utteranceQueue";
import type { UtteranceQueue } from "../utteranceQueue";
import { unplayedSinceLastPlayed } from "../unreadAnswers";

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
 *
 * **`previous` is newest first** (`utteranceQueue.ts`: *"Newest first, at most
 * MAX_PREVIOUS"* — `pushPrevious` unshifts), so a fixture reading
 * `previous: [answer(3), answer(2)]` holds `u2` and then `u3` in ARRIVAL
 * order. `pending` is the other way round: FIFO, oldest first. Getting this
 * backwards would silently reverse every positional assertion below, which is
 * why each fixture spells its arrival order out beside it.
 */
const queueOf = (parts: Partial<UtteranceQueue>): UtteranceQueue => ({
  ...emptyUtteranceQueue,
  ...parts,
});

const heardOf = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe("unplayedSinceLastPlayed", () => {
  it("the newest answer played reads zero", () => {
    // Arrival order: u2, u3, u4, u5. The newest is played and the three behind
    // it are not — under the old set-difference rule this cell showed "3"
    // forever, a number the listener had no way to drive down.
    const queue = queueOf({
      previous: [answer(3), answer(2)],
      current: answer(4),
      pending: [answer(5)],
    });

    expect(unplayedSinceLastPlayed(queue, heardOf("u5"))).toBe(0);
  });

  it("counts only the answers after the last played one", () => {
    // Arrival order: u1, u2, u3, u4, u5. The last played is u2, so the three
    // that arrived behind it are the backlog and u1 is history.
    const queue = queueOf({
      previous: [answer(3), answer(2), answer(1)],
      current: answer(4),
      pending: [answer(5)],
    });

    expect(unplayedSinceLastPlayed(queue, heardOf("u2"))).toBe(3);
  });

  it("an answer walked past without playing is not counted", () => {
    // Arrival order: u1, u2, u3, u4. The listener played u1, stepped past u2
    // without playing it, played u3, and u4 has since arrived.
    //
    // Walking past an answer without playing it is the listener declining it,
    // so u2 sits behind the position and is gone from the count: one answer is
    // outstanding, not two. (The old rule counted u2 and u4 both.)
    const queue = queueOf({
      previous: [answer(3), answer(2), answer(1)],
      current: answer(4),
    });

    expect(unplayedSinceLastPlayed(queue, heardOf("u1", "u3"))).toBe(1);
  });

  it("nothing played counts every reachable answer", () => {
    // No position to count from, so the position is the start of the list and
    // the whole of it counts. The ceiling follows from the queue's own bounds
    // rather than a number written down here: widen either and this widens.
    const ceiling = MAX_PREVIOUS + 1 + MAX_PENDING;
    const queue = queueOf({
      previous: Array.from({ length: MAX_PREVIOUS }, (_, index) => answer(index)),
      current: answer(100),
      pending: Array.from({ length: MAX_PENDING }, (_, index) => answer(200 + index)),
    });

    expect(ceiling).toBe(11);
    expect(unplayedSinceLastPlayed(queue, new Set())).toBe(ceiling);
  });

  it("an empty queue reads zero", () => {
    expect(unplayedSinceLastPlayed(emptyUtteranceQueue, new Set())).toBe(0);
  });

  it("a heard id that fell out of reach does not anchor the count", () => {
    // Answers played long ago and since pushed off the far end of the history.
    // They are no longer answers the listener can be shown, so they cannot be
    // the position the count is measured from — the last REACHABLE heard id
    // is.
    const queue = queueOf({ previous: [answer(9)], current: answer(10) });

    // u9 is the last reachable heard id, so only u10 is behind the position...
    expect(unplayedSinceLastPlayed(queue, heardOf("u1", "u2", "u3", "u9"))).toBe(1);
    // ...and dropping the unreachable ids changes nothing, which is the whole
    // claim: they anchored nothing to begin with.
    expect(unplayedSinceLastPlayed(queue, heardOf("u9"))).toBe(1);

    // And with NOTHING reachable played, the whole list counts however many
    // out-of-reach ids the set is still carrying.
    expect(unplayedSinceLastPlayed(queueOf({ current: answer(9) }), heardOf("u1", "u2"))).toBe(1);
  });

  it("counts nothing when everything reachable has been played", () => {
    // Arrival order: u2, u3, u4 — and every one of them played, so there is
    // nothing behind the position at all.
    const queue = queueOf({
      previous: [answer(2)],
      current: answer(3),
      pending: [answer(4)],
    });

    expect(unplayedSinceLastPlayed(queue, heardOf("u2", "u3", "u4"))).toBe(0);
  });

  it("drops by one when the next answer along is played", () => {
    // Arrival order: u2, u3, u4. Playing u3 moves the position onto it, so the
    // backlog loses exactly the answer that was just played.
    const queue = queueOf({
      previous: [answer(2)],
      current: answer(3),
      pending: [answer(4)],
    });

    const before = unplayedSinceLastPlayed(queue, heardOf("u2"));

    expect(before).toBe(2);
    expect(unplayedSinceLastPlayed(queue, heardOf("u2", "u3"))).toBe(before - 1);
  });

  it("counts an answer held in two slots once", () => {
    // The channel's own dedupe should keep this out of a real queue, but the
    // count is keyed on the id and so is `heard`: playing the answer once
    // would clear both copies, so counting it twice promises a step back the
    // listener can never take.
    const repeated = answer(7);
    const queue = queueOf({ previous: [repeated], current: repeated });

    expect(unplayedSinceLastPlayed(queue, new Set())).toBe(1);
  });
});
