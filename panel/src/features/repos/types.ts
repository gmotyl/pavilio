import type { PrFilter } from "../../preferences/declarations";
import type { PreferenceSetter } from "../../preferences/usePreference";
import type { RepoEntry } from "../projects/useProjects";
import type { PrsState } from "./usePrs";
import type { SearchRequest } from "./useSearchShortcut";

/** A URL query patch: a string sets the key, null deletes it. Applied with history replace. */
export type ParamsPatch = Record<string, string | null>;

/** What `ReposTab` hands each of its views (Review, Code, PRs). */
export interface ReposViewProps {
  project: string;
  repos: RepoEntry[];
  /** Open PRs for the project, already narrowed by `filter`. */
  prs: PrsState;
  filter: PrFilter;
  setFilter: PreferenceSetter<PrFilter>;
  params: URLSearchParams;
  setParams: (patch: ParamsPatch) => void;
  /** The top bar's context slot; a view portals its switcher here (null until mounted). */
  contextSlot: HTMLElement | null;
  /** Pending Ctrl+P / Ctrl+Shift+F; the Code view focuses its search and calls `onSearchHandled`. */
  searchRequest: SearchRequest | null;
  onSearchHandled: () => void;
}
