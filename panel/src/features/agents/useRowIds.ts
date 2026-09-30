import { useState } from "react";

/**
 * Stable React keys for an ordered list whose entries carry no id of their own
 * — the launcher row and the composer shortcuts.
 *
 * Index keys are wrong for a list that can change under a focused row: when
 * another tab removes an earlier entry, every later entry moves up one place,
 * and a row keyed by its index keeps its in-progress edit while its `entry`
 * becomes the NEXT launcher — so the blur writes the edit onto an entry the
 * user never touched. Keying rows by the entry they show instead carries the
 * row's state (and its edit) with that entry, and unmounts the row, edit and
 * all, when the entry is gone.
 *
 * An entry's IDENTITY is the caller's `identityOf` — name + command for a
 * launcher, label + text for a shortcut — which is not unique: two entries may
 * share it. So a new list is matched against the previous one in three passes:
 *
 * 1. same index, same identity — nothing moved;
 * 2. same identity anywhere, first unused previous entry in order — it moved
 *    (the probe: `[a, b, c]` → `[b, c]` keeps `b`'s and `c`'s rows);
 * 3. same index, any identity, if that previous row is still unused — the
 *    entry was edited in place, here or in another tab (a rename of `b` is
 *    still `b`'s row). ONLY while the list kept its length and pass 2 moved
 *    nothing: a position says which entry it holds only when no entry was
 *    added, removed or shifted. Otherwise one write that removes `a` and
 *    renames `b` (`[a, b, c]` → `[b2, c]`) would hand `b2` the row of `a` —
 *    and `a`'s in-progress edit, which the blur would write over `b`. The
 *    settings' commit guard cannot catch that: it compares against the entry
 *    the row shows, which is already `b2`.
 *
 * Anything left gets a fresh id, and a previous id left unmatched is a removed
 * row. Between duplicates the earlier previous entry wins, so removing the
 * first of two identical entries elsewhere may drop an edit on the second one
 * — dropped, never misdirected. So does a rename elsewhere in the same write
 * as a removal: the renamed entry's row starts fresh.
 *
 * A pass-3 match changes the row's identity under it. A row with a pending
 * edit keeps its draft for every field the user edited and takes the new
 * value for the rest — so a field changed BOTH here and elsewhere keeps the
 * local draft, and the blur writes it over the other tab's change. That is
 * the rows' rule for any write elsewhere, not special to pass 3.
 */
export function reconcileRowIds<T>(
  previous: readonly T[],
  previousIds: readonly number[],
  nextId: number,
  list: readonly T[],
  identityOf: (entry: T) => string,
): { ids: number[]; nextId: number } {
  // Dense, not `new Array(n)`: `map` below skips holes.
  const ids: (number | undefined)[] = list.map(() => undefined);
  const used = new Array<boolean>(previous.length).fill(false);
  const previousKeys = previous.map(identityOf);
  const keys = list.map(identityOf);

  keys.forEach((key, i) => {
    if (i < previous.length && previousKeys[i] === key) {
      ids[i] = previousIds[i];
      used[i] = true;
    }
  });
  // Pass 1 took every same-index match, so a pass-2 match is always a move.
  let moved = false;
  keys.forEach((key, i) => {
    if (ids[i] !== undefined) return;
    const j = previousKeys.findIndex((k, index) => !used[index] && k === key);
    if (j === -1) return;
    ids[i] = previousIds[j];
    used[j] = true;
    moved = true;
  });
  const inPlace = !moved && previous.length === list.length;
  let fresh = nextId;
  const resolved = ids.map((id, i) => {
    if (id !== undefined) return id;
    if (inPlace && !used[i]) {
      used[i] = true;
      return previousIds[i];
    }
    return fresh++;
  });
  return { ids: resolved, nextId: fresh };
}

/** One key per entry of `list`, following each entry across writes. */
export function useRowIds<T>(list: readonly T[], identityOf: (entry: T) => string): readonly number[] {
  const [state, setState] = useState(() => ({
    list,
    ids: list.map((_, i) => i),
    nextId: list.length,
  }));
  if (state.list === list) return state.ids;
  // Adjusted during render, like the rows' drafts, so a row never paints for
  // one frame under the key of the entry that used to sit at its index.
  const { ids, nextId } = reconcileRowIds(state.list, state.ids, state.nextId, list, identityOf);
  setState({ list, ids, nextId });
  return ids;
}
