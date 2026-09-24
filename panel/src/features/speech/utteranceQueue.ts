/**
 * The per-cell **utterance queue**: five steps of history, the utterance the
 * transport is on, and the answers waiting behind it.
 *
 * It holds **whole agent responses** — a finished answer, or a question the
 * agent is parked on. It never holds fragments of one: those are **speech
 * units**, they live inside a single utterance, and they belong to the
 * scrubber. So "+2" on the control bar means two more answers waiting, not two
 * more paragraphs.
 *
 * A pure reducer on purpose: no React, no timers, no player. The host owns the
 * effects (starting a run, marking a cell heard) and this file owns only what
 * the list looks like afterwards, which is what makes the whole event table
 * testable without mounting anything.
 *
 * Two disciplines it keeps, both load-bearing:
 * - the input state is never mutated — every change returns a fresh object;
 * - a genuine no-op returns the **same object reference**, so a `useReducer`
 *   hosting this skips the render instead of repainting the grid on a key the
 *   queue had nothing to do with.
 *
 * Nothing here is persisted: the queue lives in the tab, and a reload leaves the
 * cell with the server's one stored utterance and an empty history.
 */
import type { Utterance } from "./types";

/**
 * How many answers may wait behind the one being spoken. Past this the
 * **oldest** pending is dropped: what a listener wants after a long run is the
 * recent traffic, not the backlog it has already been overtaken by.
 */
export const MAX_PENDING = 5;

/**
 * How far back the transport can walk. History used to be a single slot, which
 * made a backlog unwalkable: a listener who stepped back past the last answer
 * found nothing behind it. Five is the same depth the queue already tolerates
 * ahead of the cursor, so a run that overtook a listener can be read back in
 * full without the cell holding an unbounded transcript.
 */
export const MAX_PREVIOUS = 5;

export interface UtteranceQueue {
  /** Newest first, at most MAX_PREVIOUS. */
  previous: Utterance[];
  current: Utterance | null;
  /** FIFO, oldest first, at most MAX_PENDING. */
  pending: Utterance[];
  /** 0 = `current`; n > 0 = `previous[n - 1]`. */
  cursor: number;
}

export type UtteranceQueueEvent =
  /** A broadcast landed for this cell. `speaking` is the cell's own state. */
  | { type: "arrived"; utterance: Utterance; speaking: boolean }
  /** The last unit of the utterance under the cursor played to its end. */
  | { type: "finished" }
  /** Previous pressed, on any of the three surfaces. */
  | { type: "previous" }
  /** Next pressed, on any of the three surfaces. */
  | { type: "next" }
  /**
   * Put the cursor back on the newest answer, without playing anything.
   *
   * Not a transport press, and deliberately not expressible as one. An answer
   * landing while the listener is parked in the history releases the pane's
   * hold on the text (see `features/terminal/answerWaiting.ts`), and the body
   * then has to show the answer that just landed rather than the older one the
   * listener had stepped back to — otherwise the arrival is invisible. `next`
   * cannot serve: it steps ONE place and speaks what it steps onto, which both
   * lands on the wrong answer from two steps back and cuts off the sentence
   * the listener is in the middle of hearing.
   */
  | { type: "newest" };

/**
 * The state every cell starts in — and a **module singleton**, handed out as
 * the initial state of every queue in the panel. So it is frozen, both lists
 * included: one stray mutation anywhere would not corrupt one cell, it would
 * poison the starting point of every cell that has not received an utterance
 * yet.
 *
 * Freezing takes nothing away from the declared type: `Object.freeze` narrows
 * no member, it only makes the writes the type would have permitted throw.
 */
export const emptyUtteranceQueue: UtteranceQueue = Object.freeze({
  previous: Object.freeze([]) as unknown as Utterance[],
  current: null,
  pending: Object.freeze([]) as unknown as Utterance[],
  cursor: 0,
});

/**
 * The utterance the transport is on — the one a play, a pause or a `finished`
 * is about. The cursor's meaning lives here, in the file that owns the cursor,
 * rather than being re-inlined as `previous[cursor - 1]` at every surface that
 * has to ask it.
 */
export const utteranceUnderCursor = (state: UtteranceQueue): Utterance | null =>
  state.cursor === 0 ? state.current : (state.previous[state.cursor - 1] ?? null);

/**
 * Push a superseded answer onto the front of the history, dropping the oldest
 * once it is full. A null `current` pushes nothing: an empty cursor is not a
 * step of history, and writing one would cost the listener a real answer at the
 * far end of the list.
 */
const pushPrevious = (previous: Utterance[], utterance: Utterance | null): Utterance[] =>
  utterance === null ? previous : [utterance, ...previous].slice(0, MAX_PREVIOUS);

/**
 * Where the cursor has to sit to stay on the **same utterance** after the
 * history has shifted under it. A cursor on `current` stays on `current`; one
 * parked in history moves back a step for the answer pushed in front of it, and
 * clamps at the oldest answer still held if its own has just fallen off the
 * end.
 */
const trackCursor = (cursor: number, shifted: boolean, previous: Utterance[]): number => {
  if (cursor === 0) return 0;
  return Math.min(shifted ? cursor + 1 : cursor, previous.length);
};

/**
 * `current` steps back into the history and the head of `pending` takes its
 * place. Only ever reached with the cursor on `current` — a replay ends by
 * returning the cursor, never by moving the list on — so the cursor lands at 0.
 */
const advance = (state: UtteranceQueue): UtteranceQueue => ({
  previous: pushPrevious(state.previous, state.current),
  current: state.pending[0] ?? null,
  pending: state.pending.slice(1),
  cursor: 0,
});

export function utteranceQueueReducer(
  state: UtteranceQueue,
  event: UtteranceQueueEvent,
): UtteranceQueue {
  switch (event.type) {
    case "arrived": {
      // A live run is never cut short by a newer answer: it waits its turn.
      if (event.speaking) {
        const queued = [...state.pending, event.utterance];
        const pending =
          queued.length > MAX_PENDING ? queued.slice(queued.length - MAX_PENDING) : queued;
        return { ...state, pending };
      }
      // Idle: the arrival is what the transport is on, and whatever it
      // superseded becomes the newest step of history. A listener already
      // reading something older is not yanked out of it — the cursor follows
      // its own utterance down the list.
      const previous = pushPrevious(state.previous, state.current);
      return {
        previous,
        current: event.utterance,
        pending: state.pending,
        // A step of history is added exactly when there was an utterance to
        // supersede, so that is what the cursor has to be tracked against.
        cursor: trackCursor(state.cursor, state.current !== null, previous),
      };
    }

    case "finished": {
      // Finishing a replay out of the history only returns the cursor; the
      // utterance sitting in `current` has not been heard and must not be
      // shifted away.
      if (state.cursor > 0) return { ...state, cursor: 0 };
      if (state.current === null && state.pending.length === 0) return state;
      return advance(state);
    }

    case "previous": {
      // The cursor may sit one step per remembered answer, and no further.
      if (state.cursor >= state.previous.length) return state;
      return { ...state, cursor: state.cursor + 1 };
    }

    case "next": {
      // Back towards the newest answer first; only then forward into what is
      // waiting.
      if (state.cursor > 0) return { ...state, cursor: state.cursor - 1 };
      if (state.pending.length === 0) return state;
      return advance(state);
    }

    case "newest": {
      // The whole of the move: the cursor, home, in one step however deep the
      // listener had walked. Nothing is consumed, promoted or dropped — an
      // answer waiting behind the cursor is still waiting afterwards.
      //
      // A cursor already at 0 is every arrival for a cell nobody stepped back
      // in, so the no-op has to hand the SAME reference back: a fresh object
      // there would repaint the grid on the one event that changed nothing
      // about what the cell is showing.
      return state.cursor === 0 ? state : { ...state, cursor: 0 };
    }

    default:
      return state;
  }
}
