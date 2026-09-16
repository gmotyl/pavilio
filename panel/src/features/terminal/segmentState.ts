/**
 * One segment's state, for anyone drawing the run as a strip of units.
 *
 * Two surfaces draw that strip: the bar's scrubber and the answer pane's gutter
 * rail. If each derived the colour on its own they would drift — one warming
 * cascade, two readings — so the rule lives here and both call it. The bar
 * still owns the one fact the rail cannot see (a measured duration means the
 * unit has been played); everything else is decided from the playhead and the
 * cache alone, which is what this module takes.
 */
import type { SpeechCacheState } from "../speech/synth";

/**
 * A segment's state. Five, because `ready` had to split: the cache stores the
 * in-flight promise, so "is it cached" said yes the moment the socket opened
 * and `cascadeWarm`'s three concurrent slots flipped three segments together —
 * a ladder that read as a single step.
 *
 * `warming` is not a fifth colour either: it borrows the red the speak control
 * already uses for *blocked on synthesis*, which is the same fact at unit
 * granularity. And it is never terminal — a failed synthesis evicts the entry,
 * so the segment returns to `cold`, the honest state for a unit nothing is
 * fetching. Clicking either is still allowed.
 */
export type SegmentState = "played" | "playing" | "warming" | "ready" | "cold";

export function segmentStateFor(args: {
  index: number;
  /** `progress?.unitIndex ?? null` — null when this cell is not the one running. */
  playingIndex: number | null;
  /** The cache's own three answers — three of the five states, verbatim. */
  cache: SpeechCacheState;
}): SegmentState {
  const { index, playingIndex, cache } = args;
  if (playingIndex !== null) {
    if (index === playingIndex) return "playing";
    if (index < playingIndex) return "played";
  }
  // Absent, in flight, or in hand — ahead of the playhead, or with no run at
  // all, the cache is the only thing that knows.
  return cache;
}
