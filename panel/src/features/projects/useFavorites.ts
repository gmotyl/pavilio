import { useCallback, useMemo } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

export function useFavorites() {
  const [stored, setStored] = usePreference(preferences.favoriteProjects);

  // The stored value is a list; the hook has always handed out a Set. The
  // `Array.isArray` guard keeps the old fallback: a stored value that is not a
  // list used to make `new Set(…)` throw on a non-iterable and land in the
  // catch, and it must still read as no favorites rather than crash.
  const favorites = useMemo(
    () => new Set<string>(Array.isArray(stored) ? stored : []),
    [stored],
  );

  // The updater rebuilds the Set from the LATEST stored list, not from the
  // `favorites` this render captured. Toggling two different names in one tick
  // used to have both calls branch off the same captured Set, so the second
  // write dropped the first name entirely.
  const toggle = useCallback(
    (name: string) => {
      setStored((previous) => {
        const next = new Set<string>(Array.isArray(previous) ? previous : []);
        next.has(name) ? next.delete(name) : next.add(name);
        return [...next];
      });
    },
    [setStored],
  );

  const isFavorite = useCallback((name: string) => favorites.has(name), [favorites]);

  /** Sort: favorites first (preserving original order within each group) */
  const sortWithFavorites = useCallback(
    <T extends { name: string }>(items: T[]): T[] => {
      const fav = items.filter((i) => favorites.has(i.name));
      const rest = items.filter((i) => !favorites.has(i.name));
      return [...fav, ...rest];
    },
    [favorites]
  );

  return { favorites, toggle, isFavorite, sortWithFavorites };
}
