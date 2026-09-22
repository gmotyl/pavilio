import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

export type GitViewMode = "flat" | "tree";

/**
 * How the git file lists are laid out, remembered across sessions.
 *
 * The mode used to be read as `stored === "tree" ? "tree" : "flat"`, which
 * quietly folded "nothing stored" and "something unreadable" into `flat`. The
 * declaration says the same thing out loud: `oneOf(["flat", "tree"])` rejects
 * anything else and the store falls back to the declared default, `flat`.
 */
export function useGitViewMode(): [GitViewMode, (mode: GitViewMode) => void] {
  return usePreference(preferences.gitViewMode);
}
