import { useSyncExternalStore } from "react";

/**
 * A per-cell count of the user's play presses — Play, Resume and *Read from
 * here*, from any surface (the bar, the answer body's row buttons, the speech
 * keys, the media keys). The speech host notes each one; the answer pane reads
 * the count only to learn that a press HAPPENED, so the value itself means
 * nothing beyond "it moved".
 *
 * Presses, never playback: an answer autoplay starts on its own is not the user
 * asking to read along, so it must not move this.
 */
const presses = new Map<string, number>();
const listeners = new Set<() => void>();

export function notePlayPress(sessionId: string): void {
  presses.set(sessionId, (presses.get(sessionId) ?? 0) + 1);
  for (const listener of listeners) listener();
}

export function playPressCount(sessionId: string): number {
  return presses.get(sessionId) ?? 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** {@link playPressCount}, re-reading the caller on every press. */
export function usePlayPressCount(sessionId: string): number {
  return useSyncExternalStore(
    subscribe,
    () => playPressCount(sessionId),
    () => playPressCount(sessionId),
  );
}

/** Tests only: forget every press. */
export function resetPlayPressesForTests(): void {
  presses.clear();
}
