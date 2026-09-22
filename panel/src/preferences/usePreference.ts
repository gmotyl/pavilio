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

/**
 * The setter. It takes a value, or an updater over the LATEST value — the same
 * two shapes `useState` offers, and for the same reason: two calls in one tick
 * must compose. A value read out of the render closure is the one the first
 * call already replaced, so `toggle(); toggle();` would collapse into a single
 * flip and a two-name favorites toggle would drop one of them.
 *
 * An updater that returns the value it was given is a no-op, exactly as
 * `setState` treats one — that is how an idempotence guard is spelt now. The
 * value form always writes, so re-asserting a value after `clearPreference`
 * still reaches the store.
 */
export type PreferenceSetter<T> = (next: T | ((previous: T) => T)) => void;

export function usePreference<T>(
  def: PreferenceDef<T>,
  scopeArg?: string,
): [T, PreferenceSetter<T>] {
  const [value, setValue] = useState<T>(() => readPreference(def, scopeArg));
  // The key the state in hand was read under, so a scope change can be told
  // apart from a re-subscribe under the same key.
  const readKey = useRef<string | null>(null);
  /**
   * The latest value, updated by every path that can change it — including the
   * setter itself, synchronously, before React has re-rendered. That is what
   * makes an updater see its predecessor's result within one tick.
   */
  const latest = useRef<T>(value);

  const adopt = useCallback((next: T) => {
    latest.current = next;
    setValue(next);
  }, []);

  useEffect(() => {
    const key = storageKey(def, scopeArg);
    // A changed scope means the state belongs to the previous project or repo:
    // the initializer runs once, so only this can correct it. Skipped on the
    // first run, and on a re-run under the same key, because re-reading there
    // would cost an extra render for every object-valued preference — a fresh
    // object is never `Object.is`-equal to the one already in state.
    if (readKey.current !== null && readKey.current !== key) {
      adopt(readPreference(def, scopeArg));
    }
    readKey.current = key;

    return subscribePreference(def as PreferenceDef<unknown>, scopeArg, () => {
      adopt(readPreference(def, scopeArg));
    });
  }, [def, scopeArg, adopt]);

  const set = useCallback<PreferenceSetter<T>>(
    (next) => {
      const previous = latest.current;
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(previous) : next;
      // An updater that hands back its own argument asked for nothing.
      if (typeof next === "function" && Object.is(resolved, previous)) return;
      // Local state first so the render happens now; the store then notifies
      // every other hook on the same key and queues the PATCH.
      adopt(resolved);
      writePreference(def, resolved, scopeArg);
    },
    [def, scopeArg, adopt],
  );

  return [value, set];
}
