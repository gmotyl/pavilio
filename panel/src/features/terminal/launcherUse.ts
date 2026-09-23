/**
 * Which cells have had a launcher pill clicked — kept OUTSIDE React, keyed by
 * session, for the life of the tab.
 *
 * ## Why the pills cannot key off speech
 *
 * `SpeechControlBar` swaps the pills for the transport the moment the cell's
 * speech state leaves `empty`, and until this module existed that swap was the
 * ONLY thing that stopped a launcher offering to launch again. Launching and
 * speaking are different moments: an agent loads, prints a banner and works for
 * minutes before its first hook fires, and for the whole of that window the row
 * still showed three live buttons. Clicking one there does not start a second
 * agent — it types `claude` into the prompt of the one already running.
 *
 * So the row needs a fact the speech host cannot supply: a launcher was used
 * HERE. That fact is this module.
 *
 * ## Why it is not component state
 *
 * The same reason `answerPaneState.ts` and `answerWaiting.ts` give, and it is
 * not a theoretical one: `TerminalView` is remounted by every layout change —
 * maximize swaps the grid for a fullscreen stack, presets and drag placement
 * rebuild it — so a flag held in the bar would be cleared by resizing the cell
 * whose agent had just been launched, and the pills would come back live.
 *
 * In memory on purpose. A reload starts every cell offering its launchers
 * again, which is honest: the panel tracks agents by pid and cwd
 * (`useAgents`), never by session id, so after a reload it genuinely does not
 * know whether the cell's agent is still there.
 *
 * A destroyed session drops its entry — see `destroyTerminal`.
 */
import { useSyncExternalStore } from "react";

const used = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** A launcher pill in this cell was clicked. Idempotent — the second click of
 *  a pill that is already disabled cannot get here, but a re-launch by any
 *  other route must not notify for nothing. */
export function noteLauncherUsed(sessionId: string): void {
  if (used.has(sessionId)) return;
  used.add(sessionId);
  notify();
}

export function hasLauncherBeenUsed(sessionId: string): boolean {
  return used.has(sessionId);
}

/** Drops the session's flag; the next read is a fresh cell. */
export function forgetLauncherUse(sessionId: string): void {
  if (!used.delete(sessionId)) return;
  notify();
}

export function subscribeLauncherUse(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this cell has launched, re-rendering the caller when that changes. */
export function useLauncherUsed(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribeLauncherUse,
    () => hasLauncherBeenUsed(sessionId),
    () => hasLauncherBeenUsed(sessionId),
  );
}

/**
 * Test-only teardown: this is tab-scoped module state that outlives a test's
 * unmount the same way the composer's drafts do, so `test-setup.ts` clears it
 * between tests — without it a suite that clicked a pill would hand the next
 * test a cell whose launchers were already spent.
 */
export function __resetLauncherUseForTests(): void {
  if (used.size === 0) return;
  used.clear();
  notify();
}
