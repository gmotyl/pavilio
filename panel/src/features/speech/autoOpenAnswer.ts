/**
 * The browser-wide default for the answer pane's "Open on new answer" switch.
 *
 * PORTABLE: it is a choice about how the panel behaves, not a fact about this
 * machine, so it travels in the workspace file alongside the voice. Reads and
 * writes go through the preference registry, which owns the try/catch around
 * storage — `voices.ts`'s exported `getBrowserStorage()` accessor, which this
 * module used to import, is gone. That import was the reason a raw
 * `localStorage` grep counted this module clean while it was reaching storage
 * all along.
 *
 * The default is OFF. It is a DEFAULT: each `TerminalView` seeds its own switch
 * from it once, at mount, and never writes back — so a cell flipped mid-session
 * keeps its choice, and a change here reaches only cells mounted afterwards.
 */
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

/** False when nothing is stored, and when the stored value is malformed. */
export function getStoredAutoOpenAnswer(): boolean {
  return readPreference(preferences.answerPaneAutoOpen);
}

/**
 * Stores the default and returns the value now in effect — `on` itself, so a
 * page whose portable document never arrived (the store drops the write) still
 * gets the choice applied for this page.
 */
export function setStoredAutoOpenAnswer(on: boolean): boolean {
  writePreference(preferences.answerPaneAutoOpen, on);
  return on;
}
