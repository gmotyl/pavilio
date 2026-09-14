/**
 * The per-cell **utterance queue**: one step of history, the utterance the
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

export interface UtteranceQueue {
  /** One step of history. Null until something has finished or been superseded. */
  previous: Utterance | null;
  current: Utterance | null;
  /** FIFO, oldest first, at most MAX_PENDING. */
  pending: Utterance[];
  /** Which of previous|current the transport is on. */
  cursor: "previous" | "current";
}

export type UtteranceQueueEvent =
  /** A broadcast landed for this cell. `speaking` is the cell's own state. */
  | { type: "arrived"; utterance: Utterance; speaking: boolean }
  /** The last unit of the utterance under the cursor played to its end. */
  | { type: "finished" }
  /** Previous pressed, on any of the three surfaces. */
  | { type: "previous" }
  /** Next pressed, on any of the three surfaces. */
  | { type: "next" };

/**
 * The state every cell starts in — and a **module singleton**, handed out as
 * the initial state of every queue in the panel. So it is frozen, list and all:
 * one stray mutation anywhere would not corrupt one cell, it would poison the
 * starting point of every cell that has not received an utterance yet.
 *
 * Freezing takes nothing away from the declared type: `Object.freeze` narrows
 * no member, it only makes the writes the type would have permitted throw.
 */
export const emptyUtteranceQueue: UtteranceQueue = Object.freeze({
  previous: null,
  current: null,
  pending: Object.freeze([]) as unknown as Utterance[],
  cursor: "current",
});

/**
 * The utterance the transport is on — the one a play, a pause or a `finished`
 * is about. The cursor's meaning lives here, in the file that owns the cursor,
 * rather than being re-inlined as `cursor === "previous" ? previous : current`
 * at every surface that has to ask it.
 */
export const utteranceUnderCursor = (state: UtteranceQueue): Utterance | null =>
  state.cursor === "previous" ? state.previous : state.current;

/**
 * `current` steps back into `previous` and the head of `pending` takes its
 * place. The old `previous` is discarded — history is one step deep by
 * decision, so `previous` is a slot and not a list.
 */
const advance = (state: UtteranceQueue): UtteranceQueue => ({
  previous: state.current,
  current: state.pending[0] ?? null,
  pending: state.pending.slice(1),
  cursor: "current",
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
      // superseded becomes the one step of history.
      return {
        previous: state.current ?? state.previous,
        current: event.utterance,
        pending: state.pending,
        cursor: "current",
      };
    }

    case "finished": {
      // Finishing a replay of `previous` only returns the cursor; the utterance
      // sitting in `current` has not been heard and must not be shifted away.
      if (state.cursor === "previous") return { ...state, cursor: "current" };
      if (state.current === null && state.pending.length === 0) return state;
      return advance(state);
    }

    case "previous": {
      if (state.previous === null || state.cursor === "previous") return state;
      return { ...state, cursor: "previous" };
    }

    case "next": {
      // Back from a replay first; only then forward into what is waiting.
      if (state.cursor === "previous") return { ...state, cursor: "current" };
      if (state.pending.length === 0) return state;
      return advance(state);
    }

    default:
      return state;
  }
}
