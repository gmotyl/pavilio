/**
 * A preference with two levels: a workspace default and a per-project
 * override, declared as two preferences and read as one value.
 *
 * `readPreference` falls back to a declaration's STATIC default, never to a
 * value stored at a wider scope, so "the project's value, else the workspace's"
 * cannot be expressed by one declaration. These helpers are that read, and the
 * two writes that keep it honest.
 *
 * The load-bearing rule is on the way back: resetting a project CLEARS its key.
 * Writing the default's current value into it instead would look identical
 * today and silently stop the project tracking every later edit to the default.
 */
import { clearPreference, readPreference, writePreference } from "./store";
import type { PreferenceDef } from "./types";

/** The project's stored value if there is one, else the workspace default's value. */
export function readOverridable<T>(
  base: PreferenceDef<T>,
  override: PreferenceDef<T | null>,
  project: string,
): T {
  const own = readPreference(override, project);
  // `null` is the override's "unset" — its declared default, and what an
  // unreadable stored value parses to.
  return own === null ? readPreference(base) : own;
}

/** Give `project` its own value, leaving every other project on the default. */
export function writeOverride<T>(
  override: PreferenceDef<T | null>,
  value: T,
  project: string,
): void {
  writePreference(override, value, project);
}

/**
 * Put `project` back on the workspace default by removing its key — never by
 * writing the default's value into it — so it follows later edits to the
 * default.
 */
export function clearOverride<T>(override: PreferenceDef<T | null>, project: string): void {
  clearPreference(override as PreferenceDef<unknown>, project);
}
