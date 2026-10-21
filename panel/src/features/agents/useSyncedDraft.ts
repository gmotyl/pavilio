import { useState } from "react";

/** Equal by value: `Object.is`, or two plain objects with the same own fields. */
function sameDraft<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

type State<T> = {
  draft: T;
  /** The source value the draft was last filled from. */
  base: T;
  /** The source key the draft was last synced to. */
  key: string;
  /** A source change arrived while a dirty draft was held. */
  heldOver: boolean;
};

/**
 * A field's editable draft of a stored value. The draft refills from `source`
 * whenever `sourceKey` changes — another tab's write, or this tab's own commit
 * — so it never shows a stale value.
 *
 * `hold` protects an edit in progress: while it is true, a DIRTY draft is kept
 * across source changes (a clean one has nothing to protect and follows the
 * source at once). When the hold is released the draft catches up only if it
 * is clean by then; a dirty one keeps the user's text and is measured against
 * the new source from then on.
 *
 * Callers pass `hold: focused`, NOT `focused && dirty`: `dirty` is this hook's
 * own output, so it is unknown when the hook is called. The hook applies the
 * "and dirty" part itself — only a dirty draft is ever held. That is what
 * `DefaultObjectiveSettings` passes; the list rows pass nothing, so any change
 * of the list drops their edits.
 *
 * `dirty` is whether the draft differs, by value, from what it was filled from.
 * Adjusted during render rather than in an effect, so stale text never paints.
 */
export function useSyncedDraft<T>(
  source: T,
  sourceKey: string,
  opts?: { hold?: boolean },
): [draft: T, setDraft: (next: T) => void, dirty: boolean] {
  const [state, setState] = useState<State<T>>(() => ({
    draft: source,
    base: source,
    key: sourceKey,
    heldOver: false,
  }));
  let current = state;
  const dirty = !sameDraft(current.draft, current.base);

  if (sourceKey !== current.key) {
    if (opts?.hold && dirty) {
      if (!current.heldOver) {
        current = { ...current, heldOver: true };
        setState(current);
      }
    } else if (current.heldOver && dirty) {
      current = { draft: current.draft, base: source, key: sourceKey, heldOver: false };
      setState(current);
    } else {
      current = { draft: source, base: source, key: sourceKey, heldOver: false };
      setState(current);
    }
  } else if (current.heldOver && !opts?.hold) {
    // The source went back to what the draft was synced to before the hold ended.
    current = { ...current, heldOver: false };
    setState(current);
  }

  const setDraft = (next: T) => setState((prev) => ({ ...prev, draft: next }));
  return [current.draft, setDraft, !sameDraft(current.draft, current.base)];
}
