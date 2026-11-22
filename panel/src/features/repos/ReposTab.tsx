import { useCallback, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { preferences, REPOS_VIEWS, type ReposView } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import type { RepoEntry } from "../projects/useProjects";
import CodeView from "./CodeView";
import PrsView from "./PrsView";
import ReviewView from "./ReviewView";
import type { ParamsPatch, ReposViewProps } from "./types";
import { usePrs } from "./usePrs";
import { useSearchShortcut } from "./useSearchShortcut";
import "./ReposTab.css";

export interface ReposTabProps {
  project: string;
  repos: RepoEntry[];
}

const PILLS: { view: ReposView; label: string }[] = [
  { view: "review", label: "Review" },
  { view: "code", label: "Code" },
  { view: "prs", label: "PRs" },
];

const VIEWS: Record<ReposView, (props: ReposViewProps) => ReactNode> = {
  review: ReviewView,
  code: CodeView,
  prs: PrsView,
};

const isView = (v: string | null): v is ReposView => REPOS_VIEWS.includes(v as ReposView);

export default function ReposTab({ project, repos }: ReposTabProps) {
  const [params, setSearchParams] = useSearchParams();
  const [storedView, setStoredView] = usePreference(preferences.reposView, project);
  const [filter, setFilter] = usePreference(preferences.reposPrFilter, project);
  const prs = usePrs(project, filter);
  // State, not a ref: views portal into the slot and must re-render once it exists.
  const [contextSlot, setContextSlot] = useState<HTMLElement | null>(null);

  const urlView = params.get("view");
  const view = isView(urlView) ? urlView : storedView;

  const setParams = useCallback(
    (patch: ParamsPatch) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const pick = (v: ReposView) => {
    setParams({ view: v });
    setStoredView(v);
  };

  const [searchRequest, clearSearchRequest] = useSearchShortcut(() => {
    if (view !== "code") pick("code");
  });

  const View = VIEWS[view];

  return (
    <div className="rt" data-testid="repos-tab">
      <div className="rt-topbar">
        <span className="rt-crumb" data-testid="repos-crumb">
          {project} / <b>Repos</b>
        </span>
        <div className="rt-views" role="group" aria-label="Repos view">
          {PILLS.map(({ view: v, label }) => (
            <button key={v} type="button" data-testid={`repos-view-${v}`} aria-pressed={view === v} onClick={() => pick(v)}>
              {label}
              {v === "prs" && prs.reviewRequested > 0 && (
                <span className="rt-n rt-n-hot" title="Your review requested" data-testid="prs-pill-count">
                  {prs.reviewRequested}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="rt-context" data-testid="repos-context" ref={setContextSlot} />
      </div>
      <div className="rt-body">
        <View
          project={project}
          repos={repos}
          prs={prs}
          filter={filter}
          setFilter={setFilter}
          params={params}
          setParams={setParams}
          contextSlot={contextSlot}
          searchRequest={searchRequest}
          onSearchHandled={clearSearchRequest}
        />
      </div>
    </div>
  );
}
