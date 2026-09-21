/**
 * The one hook every consumer of a preference uses.
 *
 * It reads inside the `useState` initializer on purpose: the value is already
 * correct on the first render, with no effect having run, so nothing flashes a
 * default and corrects itself a frame later. That guarantee is the reason
 * `GET /api/preferences.js` is a parser-blocking script rather than a fetch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { readPreference, subscribePreference, writePreference } from "./store";
import { storageKey, type PreferenceDef } from "./types";

export function usePreference<T>(
  def: PreferenceDef<T>,
  scopeArg?: string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPreference(def, scopeArg));
  // The key the state in hand was read under, so a scope change can be told
  // apart from a re-subscribe under the same key.
  const readKey = useRef<string | null>(null);

  useEffect(() => {
    const key = storageKey(def, scopeArg);
    // A changed scope means the state belongs to the previous project or repo:
    // the initializer runs once, so only this can correct it. Skipped on the
    // first run, and on a re-run under the same key, because re-reading there
    // would cost an extra render for every object-valued preference — a fresh
    // object is never `Object.is`-equal to the one already in state.
    if (readKey.current !== null && readKey.current !== key) {
      setValue(readPreference(def, scopeArg));
    }
    readKey.current = key;

    return subscribePreference(def as PreferenceDef<unknown>, scopeArg, () => {
      setValue(readPreference(def, scopeArg));
    });
  }, [def, scopeArg]);

  const set = useCallback(
    (next: T) => {
      // Local state first so the render happens now; the store then notifies
      // every other hook on the same key and queues the PATCH.
      setValue(next);
      writePreference(def, next, scopeArg);
    },
    [def, scopeArg],
  );

  return [value, set];
}
