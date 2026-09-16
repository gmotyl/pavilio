/**
 * The browser-wide default for the answer pane's "Open on new answer" switch —
 * a per-browser speech preference kept beside the voice and the armed cell, and
 * stored the same way: through `voices.ts`'s guarded accessor, with every read
 * and write in a try/catch, and unavailable storage reading as the default.
 *
 * The default is OFF. It is a DEFAULT: each `TerminalView` seeds its own switch
 * from it once, at mount, and never writes back — so a cell flipped mid-session
 * keeps its choice, and a change here reaches only cells mounted afterwards.
 */
import { getBrowserStorage } from "./voices";

export const AUTO_OPEN_ANSWER_STORAGE_KEY = "panel-answer-pane-auto-open";

/** The one value that means "on"; anything else — or nothing — is off. */
const ON = "1";

/** False when nothing is stored, when the value is not {@link ON}, or when storage throws. */
export function getStoredAutoOpenAnswer(): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;

  try {
    return storage.getItem(AUTO_OPEN_ANSWER_STORAGE_KEY) === ON;
  } catch {
    return false;
  }
}

/**
 * Stores the default and returns the value now in effect — `on` itself, so a
 * browser that refuses to store still gets the choice applied for this page.
 */
export function setStoredAutoOpenAnswer(on: boolean): boolean {
  try {
    const storage = getBrowserStorage();
    if (on) storage?.setItem(AUTO_OPEN_ANSWER_STORAGE_KEY, ON);
    else storage?.removeItem(AUTO_OPEN_ANSWER_STORAGE_KEY);
  } catch {
    // The choice stays in effect for this page when storage is unavailable.
  }

  return on;
}
