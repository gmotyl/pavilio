/**
 * How far behind the listener is: how many answers have arrived **since the
 * last one they played** — the number the waiting pane puts on screen so a run
 * that overtook somebody says how much of it is still ahead of them.
 *
 * ## Positional, not a set difference
 *
 * This used to be every reachable answer minus `heard`, and that number could
 * not be driven to zero. An answer the listener walked past without playing
 * stayed counted for as long as the queue could reach it, so the pip kept
 * reporting answers the listener had already decided to skip — and a cell
 * could show a count with its newest answer played, which reads as "there is
 * something new" when there is not.
 *
 * So the count is a **position** now: find the most recently played answer in
 * the arrival order, and count what came after it and is still unplayed.
 * Playing the newest answer takes it to zero, whatever is unplayed behind.
 * Walking past an answer without playing it is the listener declining it, and
 * a count that remembers declined answers is a number nobody can clear.
 *
 * ## Still a derivation, not a new fact
 *
 * Nothing here is recorded, subscribed to or remembered: the channel already
 * writes one id into `heard` each time an utterance plays its last unit, and
 * the queue already says which answers the transport can still be walked onto.
 * The count is those two things read together, so it cannot drift out of step
 * with either the way a separate tally would — a counter maintained alongside
 * the queue has to be decremented on playback, on a drop off the far end of
 * the history, on a pending answer discarded past `MAX_PENDING` and on a
 * re-broadcast, and missing any one of those leaves a pip on a cell with
 * nothing behind it.
 *
 * Pure on purpose, like the reducer it reads: no React, no host, no channel.
 * It takes the queue and the set and returns a number, which is what lets the
 * whole table of cases be pinned without mounting a cell.
 */
import type { UtteranceQueue } from "./utteranceQueue";

/**
 * The queue flattened into **arrival order**, oldest first.
 *
 * The two lists run opposite ways and the position this file is built on is
 * meaningless if they are read as if they did not: `previous` is *newest
 * first* — `pushPrevious` unshifts, and the cursor indexes it as
 * `previous[cursor - 1]` for one step back — so the history has to be walked
 * **backwards** to be walked forwards in time. `pending` is FIFO, oldest
 * first, and is appended to, so it reads straight through.
 */
const arrivalOrder = (queue: UtteranceQueue): string[] => {
  const ids: string[] = [];

  for (let step = queue.previous.length - 1; step >= 0; step -= 1) {
    ids.push(queue.previous[step].id);
  }
  if (queue.current) ids.push(queue.current.id);
  for (const waiting of queue.pending) ids.push(waiting.id);

  return ids;
};

/**
 * Answers that arrived **after the most recently played one** and have not
 * themselves been played.
 *
 * Walk `previous[]` (oldest first), `current`, then `pending[]` in arrival
 * order; find the **last** index present in `heard`; count the unheard entries
 * after it. Nothing in `heard` at all means the whole list counts — there is
 * no position to measure from, so the position is the start of the list.
 *
 * **Reachable is still the whole of the definition.** An id in `heard` that
 * the queue has let go of — an answer pushed off the far end of the history, a
 * pending answer dropped when the queue was already full — is not an answer
 * the listener can be shown, so it cannot be the position either. Only ids
 * still in the queue can anchor the count; the last REACHABLE one wins. (The
 * channel prunes `heard` to the same reach on every advance, so in a live cell
 * the set is already narrow; the count does not rely on that having happened.)
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
export function unplayedSinceLastPlayed(
  queue: UtteranceQueue,
  heard: ReadonlySet<string>,
): number {
  const arrived = arrivalOrder(queue);

  // The LAST played one, not the first: a listener who replayed something old
  // and then caught back up is still caught up, and the newest played answer
  // is the one that says where they are.
  let position = -1;
  for (let index = 0; index < arrived.length; index += 1) {
    if (heard.has(arrived[index])) position = index;
  }

  const unplayed = new Set<string>();
  for (let index = position + 1; index < arrived.length; index += 1) {
    const id = arrived[index];
    if (!heard.has(id)) unplayed.add(id);
  }

  return unplayed.size;
}
