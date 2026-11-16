import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { preparePage } from "./pageText";
import { PlayFromHere } from "./PlayFromHere";
import { usePanelSpeechIfMounted } from "./SpeechHostProvider";
import type { SpeechUnit } from "./types";

/*
 * Play from here on a page: the surface-agnostic `PlayFromHere` fed the page's
 * units, the host's progress for the page's key, and the page's crossing to
 * its toolbar.
 *
 * The bar is not here: the toolbar (`ViewerActions`) owns it, in the
 * breadcrumb slot — another subtree. So a press and a hover cross over through
 * the small per-key store below: a press asks the toolbar to unfold its bar and
 * start the run there; a hover names the unit whose scrubber segment the bar
 * outlines. A pinned Pause goes to the host directly: pausing needs no bar.
 */

// ── the store between the page and its toolbar ───────────────────────────────

const hints = new Map<string, number>();
const hintListeners = new Set<() => void>();
const playHandlers = new Map<string, Set<(unit: number) => void>>();

function setHint(key: string, unit: number | null): void {
  if ((hints.get(key) ?? null) === unit) return;
  if (unit === null) hints.delete(key);
  else hints.set(key, unit);
  for (const listener of hintListeners) listener();
}

function subscribeHints(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}

/** The unit a hovered or focused block of `key`'s page would start at; null when none. */
export function usePlayHint(key: string): number | null {
  return useSyncExternalStore(subscribeHints, () => hints.get(key) ?? null);
}

/**
 * Handles a ▶ press on `key`'s page: `handler` gets the unit to start at. The
 * toolbar registers here, so the press unfolds its bar and runs through it.
 */
export function usePlayFromHereHandler(key: string, handler: (unit: number) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const call = (unit: number) => ref.current(unit);
    let set = playHandlers.get(key);
    if (!set) playHandlers.set(key, (set = new Set()));
    set.add(call);
    return () => {
      set.delete(call);
      if (set.size === 0) playHandlers.delete(key);
    };
  }, [key]);
}

function requestPlay(key: string, unit: number): void {
  for (const handler of playHandlers.get(key) ?? []) handler(unit);
}

// ── the adapter ──────────────────────────────────────────────────────────────

const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const noSubscription = () => () => {};

export interface PagePlayFromHereProps {
  /** The page's speech key; without one (not markdown, still loading) the page gets no ▶. */
  docKey?: string;
  /** The page's markdown source, as handed to the toolbar's Play. */
  text: string;
  /** The rendered page. */
  children: ReactNode;
}

export function PagePlayFromHere({ docKey, text, children }: PagePlayFromHereProps) {
  const speech = usePanelSpeechIfMounted();
  // Prepared by the one page preparation the host plays from (`preparePage`:
  // frontmatter dropped, sentence units, in the page's own language), so a unit
  // index here is the same unit in the bar and in the run.
  const units = useMemo(() => (docKey ? preparePage(text).units : NO_UNITS), [docKey, text]);
  // The playhead is an external store (it moves ~4 times a second); only the
  // unit index is taken, so a playhead moving within a unit renders nothing.
  const playingUnit = useSyncExternalStore(speech?.subscribeProgress ?? noSubscription, () =>
    docKey && speech ? (speech.progressFor(docKey)?.unitIndex ?? null) : null,
  );
  // Read as the speech row reads it, so the pinned ▶ and the row agree.
  const paused = docKey !== undefined && speech?.stateFor(docKey) === "paused";

  const onPlay = useCallback(
    (unit: number) => {
      if (docKey) requestPlay(docKey, unit);
    },
    [docKey],
  );
  const onPause = useCallback(() => {
    if (docKey) speech?.onPause(docKey);
  }, [speech, docKey]);
  const onHint = useCallback(
    (unit: number | null) => {
      if (docKey) setHint(docKey, unit);
    },
    [docKey],
  );

  return (
    <PlayFromHere
      speechKey={docKey}
      units={units}
      playingUnit={playingUnit}
      paused={paused}
      onPlay={onPlay}
      onPause={onPause}
      onHint={onHint}
    >
      {children}
    </PlayFromHere>
  );
}

export default PagePlayFromHere;
