/**
 * How many answers a cell is holding that the listener has never actually
 * heard — the number the waiting pane puts on screen so a run that overtook
 * somebody says how far behind they are.
 *
 * A **derivation, not a new fact**. Nothing here is recorded, subscribed to or
 * remembered: the channel already writes one id into `heard` each time an
 * utterance plays its last unit, and the queue already says which answers the
 * transport can still be walked onto. The count is those two things read
 * together, so it cannot drift out of step with either the way a separate
 * tally would — an unread counter maintained alongside the queue has to be
 * decremented on playback, on a drop off the far end of the history, on a
 * pending answer discarded past `MAX_PENDING` and on a re-broadcast, and
 * missing any one of those leaves a pip on a cell with nothing behind it.
 *
 * Pure on purpose, like the reducer it reads: no React, no host, no channel.
 * It takes the queue and the set and returns a number, which is what lets the
 * whole table of cases be pinned without mounting a cell.
 */
import type { UtteranceQueue } from "./utteranceQueue";

/**
 * Reachable answers that have never been played: `previous[]` + `current` +
 * `pending[]`, minus `heard`.
 *
 * **Reachable** is the whole of the definition. An id in `heard` that the
 * queue has let go of — an answer pushed off the far end of the history, a
 * pending answer dropped when the queue was already full — is not subtracted
 * from anything, because it is no longer an answer the listener can be shown.
 * (The channel prunes `heard` to the same reach on every advance, so in a live
 * cell the set is already narrow; the count does not rely on that having
 * happened.)
 *
 * The ceiling follows from the queue's own bounds rather than from a number
 * written down here: `MAX_PREVIOUS` steps of history, the one utterance under
 * the cursor, and `MAX_PENDING` answers waiting behind it. Widen either bound
 * and the count widens with it.
 *
 * An id that somehow occupies two slots at once counts **once**. The identity
 * of an answer is its id — it is what `heard` is keyed on — so playing the one
 * copy marks both, and counting two would promise a step back that the
 * listener could never take. (The channel's own dedupe keeps a re-delivered
 * utterance out of a second slot in the first place; this is what the count
 * does if it ever gets there anyway.)
 */
export function unreadAnswerCount(queue: UtteranceQueue, heard: ReadonlySet<string>): number {
  const unread = new Set<string>();

  const consider = (id: string): void => {
    if (!heard.has(id)) unread.add(id);
  };

  for (const step of queue.previous) consider(step.id);
  if (queue.current) consider(queue.current.id);
  for (const waiting of queue.pending) consider(waiting.id);

  return unread.size;
}
