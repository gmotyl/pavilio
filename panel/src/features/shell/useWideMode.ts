import { useCallback } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

/**
 * Persisted wide/compact mode per view key.
 * Key examples: "viewer", "repos", "notes"
 *
 * The declared default is `true`: the old hook read `=== "true"`, so a fresh
 * browser opened every view compact. Wide is the better starting point, and the
 * registry is where that flip is made.
 */
export function useWideMode(key: string) {
  const [wide, setWide] = usePreference(preferences.wideMode, key);

  // An updater, so two toggles in one tick compose instead of collapsing into
  // one flip.
  const toggle = useCallback(() => {
    setWide((previous) => !previous);
  }, [setWide]);

  return [wide, toggle] as const;
}
