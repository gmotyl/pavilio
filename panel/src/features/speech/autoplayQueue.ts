/**
 * The panel's **autoplay queue**: the answers autoplay cells are owed, in the
 * order they arrived, across every cell in the grid.
 *
 * One `<audio>` element speaks for the whole panel, so two autoplay cells that
 * answer at once cannot both be heard now. Before this queue the host spoke the
 * last one it found and silently dropped the rest — and an arrival on one
 * autoplay cell cut another off mid-answer. Now an arrival that cannot be
 * spoken yet waits here, and the host takes the oldest one still worth speaking
 * whenever a run ends.
 *
 * What is NOT in here: the per-cell `UtteranceQueue` (`utteranceQueue.ts`),
 * which is one cell's history and backlog and drives that cell's transport.
 * This queue only orders turns BETWEEN runs; it never moves a cell's cursor.
 *
 * Pure and React-free on purpose, so the ordering rules are testable on their
 * own. Whether an entry is still worth speaking is the host's question — it
 * alone can see the cell's cursor, its heard set and its mode — so `next`
 * takes it as a predicate rather than reading any of that itself.
 */

export interface QueuedAnswer {
  sessionId: string;
  utteranceId: string;
}

export interface AutoplayQueue {
  /**
   * Appends an answer. A second entry for an utterance already queued is
   * ignored. With `isOwed`, an entry of the SAME cell that the cell no longer
   * owes — a newer answer replaced it under an idle cell's cursor — is taken
   * over in place instead: the newest answer keeps the cell's turn rather than
   * queuing behind cells that answered after the first one.
   */
  enqueue(entry: QueuedAnswer, isOwed?: (queued: QueuedAnswer) => boolean): void;
  /**
   * Removes and returns the oldest entry that `isUnheard` still accepts,
   * dropping every stale entry ahead of it on the way; `null` when none is left.
   */
  next(isUnheard: (entry: QueuedAnswer) => boolean): QueuedAnswer | null;
  /** Drops every entry for one cell — the cell has left autoplay. */
  dropSession(sessionId: string): void;
  /**
   * Drops every entry `isUnheard` no longer accepts, wherever it sits, without
   * dequeuing anything. Keeps a long wait from holding answers that were heard
   * by hand in the meantime.
   */
  dropStale(isUnheard: (entry: QueuedAnswer) => boolean): void;
  /** The entries in turn order. For tests and diagnostics. */
  entries(): readonly QueuedAnswer[];
}

export function createAutoplayQueue(): AutoplayQueue {
  let queue: QueuedAnswer[] = [];

  return {
    enqueue(entry, isOwed) {
      // Keyed on the utterance alone: an id names one answer from one cell, and
      // seeing it twice (a re-render, a re-broadcast) is the same arrival.
      if (queue.some((queued) => queued.utteranceId === entry.utteranceId)) return;
      const fresh = { sessionId: entry.sessionId, utteranceId: entry.utteranceId };
      const superseded = isOwed
        ? queue.findIndex((queued) => queued.sessionId === entry.sessionId && !isOwed(queued))
        : -1;
      if (superseded < 0) {
        queue.push(fresh);
        return;
      }
      // The first superseded entry's slot is the cell's turn; any later ones of
      // the same cell are just as stale and would only be dropped at their turn.
      queue = queue.filter(
        (queued, index) =>
          index <= superseded || queued.sessionId !== entry.sessionId || isOwed?.(queued),
      );
      queue[superseded] = fresh;
    },

    next(isUnheard) {
      while (queue.length > 0) {
        const head = queue.shift() as QueuedAnswer;
        if (isUnheard(head)) return head;
      }
      return null;
    },

    dropSession(sessionId) {
      queue = queue.filter((queued) => queued.sessionId !== sessionId);
    },

    dropStale(isUnheard) {
      queue = queue.filter(isUnheard);
    },

    entries() {
      return queue.slice();
    },
  };
}
