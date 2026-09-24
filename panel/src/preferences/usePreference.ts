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
import { isPreferenceScope, storageKey, type PreferenceDef } from "./types";

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
  // Resolved unconditionally, and that is the strictness rather than an
  // oversight: the scope is this caller's promise, and `storageKey` still
  // throws from inside the body if the promise was not kept. A caller that
  // KNOWS its scope may not resolve says so by reaching for
  // `useScopedPreference` below, rather than by handing this one a blank.
  return useStoredPreference(def, scopeArg, true);
}

/**
 * The same hook, for a caller whose scope may not have resolved.
 *
 * Some scopes are looked up rather than known: a project read off the tab's
 * session list, a repo path discovered from `repos.json`. Those lookups come
 * back empty often enough to be a shape rather than a hypothesis, and a blank
 * scope is a MISSING scope rather than a scope — `storageKey` throws on one
 * instead of letting every project share a single key, and a read that throws
 * during render takes the surface down with it.
 *
 * So an unresolved scope is answered honestly here: the hook reports the
 * DECLARED DEFAULT, it keeps whatever the user does for as long as the scope
 * stays unresolved so the control still works under the hand, and it PERSISTS
 * NOTHING. That is the rule `isPreferenceScope` states and `writeTerminalFocus`
 * already follows.
 * Writing under a placeholder scope instead would put the value somewhere
 * nothing reads it back from — which discards user input while looking like it
 * stored it — and would pool every unresolved caller onto one number on the way.
 *
 * A scope that resolves later is not a lost cause: the effect below notices the
 * new key and adopts what is stored under it, so a surface that mounted early
 * corrects itself as soon as the lookup succeeds.
 *
 * That adoption is what bounds the sentence above, and the order matters when
 * both happen: a value dragged while the scope was unresolved is REPLACED by
 * whatever the resolved scope has stored, rather than surviving the transition
 * or being written into it. It has to be. The dragged number was never
 * persisted — that is the whole of the unresolved rule — so keeping it would
 * leave the control showing a height the project does not have and will not
 * have after a reload, and writing it would store a number the user chose
 * before anyone knew which project they were choosing it for. A stored value
 * loses only to a drag that can be stored.
 *
 * A `global` declaration has no scope to resolve and so is never unresolved: it
 * behaves here exactly as it does under `usePreference`.
 */
export function useScopedPreference<T>(
  def: PreferenceDef<T>,
  scope: string | null | undefined,
): [T, PreferenceSetter<T>] {
  return useStoredPreference(
    def,
    scope ?? undefined,
    def.scope === "global" || isPreferenceScope(scope),
  );
}

/**
 * The body both hooks share.
 *
 * `resolved` is the only axis between them: false means there is no key to
 * name, so there is nothing to read, nothing to subscribe to and nothing to
 * write — the value lives in this hook's own state and dies with it.
 */
function useStoredPreference<T>(
  def: PreferenceDef<T>,
  scopeArg: string | undefined,
  resolved: boolean,
): [T, PreferenceSetter<T>] {
  const [value, setValue] = useState<T>(() =>
    resolved ? readPreference(def, scopeArg) : def.default,
  );
  /**
   * The key the state in hand was read under, so a scope change can be told
   * apart from a re-subscribe under the same key. Three states rather than two:
   * `undefined` is "no effect has run yet", and `null` is "the scope did not
   * resolve" — its own state, because a later resolution is noticed AGAINST it.
   */
  const readKey = useRef<string | null | undefined>(undefined);
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
    const key = resolved ? storageKey(def, scopeArg) : null;
    // A changed scope means the state belongs to the previous project or repo:
    // the initializer runs once, so only this can correct it. Skipped on the
    // first run, and on a re-run under the same key, because re-reading there
    // would cost an extra render for every object-valued preference — a fresh
    // object is never `Object.is`-equal to the one already in state.
    if (readKey.current !== undefined && readKey.current !== key) {
      adopt(resolved ? readPreference(def, scopeArg) : def.default);
    }
    readKey.current = key;
    // No key, nothing to subscribe to: there is no store entry for a notify to
    // be about, and the value in hand is this hook's own.
    if (key === null) return;

    return subscribePreference(def as PreferenceDef<unknown>, scopeArg, () => {
      adopt(readPreference(def, scopeArg));
    });
  }, [def, scopeArg, resolved, adopt]);

  const set = useCallback<PreferenceSetter<T>>(
    (next) => {
      const previous = latest.current;
      const nextValue =
        typeof next === "function" ? (next as (p: T) => T)(previous) : next;
      // An updater that hands back its own argument asked for nothing.
      if (typeof next === "function" && Object.is(nextValue, previous)) return;
      // Local state first so the render happens now; the store then notifies
      // every other hook on the same key and queues the PATCH.
      adopt(nextValue);
      // An unresolved scope names no key. The control still moved — the adopt
      // above is what moves it — but the number goes no further, because every
      // key it could go to is one nothing will read it back from.
      if (!resolved) return;
      writePreference(def, nextValue, scopeArg);
    },
    [def, scopeArg, resolved, adopt],
  );

  return [value, set];
}
