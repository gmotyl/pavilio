import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Unavailable } from "../../../server/lib/prs/provider";
import { useFileIndex } from "../explorer/useFileIndex";
import { explainable, explainRunLine } from "../projects/runPrompt";
import { useLaunchRun } from "../projects/useLaunchRun";
import { launcherBlockedReason, useProjectLauncher } from "../projects/useProjectLauncher";
import PrFilter from "./PrFilter";
import PrRow, { moveListFocus, prKey } from "./PrRow";
import type { ReposViewProps } from "./types";
import type { PrsState, PullRequest } from "./usePrs";
import "./Prs.css";

const RESTING: Record<Exclude<Unavailable, "failed">, ReactNode> = {
  "not-github": "No GitHub remote",
  "gh-missing": (
    <>
      <code>gh</code> is not installed
    </>
  ),
  "gh-unauthenticated": (
    <>
      Run <code>gh auth login</code>
    </>
  ),
};

/** Per-repo resting lines and the unknown-identity note; shared by the PRs view and the Review switcher. */
export function PrsNotices({ prs, testIdPrefix = "prs" }: { prs: PrsState; testIdPrefix?: string }) {
  return (
    <>
      {prs.identityUnknown && (
        <p className="prs-status" role="status" data-testid={`${testIdPrefix}-identity-unknown`}>
          Couldn't tell who you are on GitHub, so Mine and Review requested are unavailable.
        </p>
      )}
      {prs.unavailable.length > 0 && (
        <ul className="prs-unavailable" aria-label="Unavailable repositories">
          {prs.unavailable.map(({ repo, reason }) => (
            <li key={repo}>
              <span className="pr-repo">{repo}</span>
              {reason === "failed" ? (
                <>
                  <span>Couldn't load pull requests</span>
                  <button type="button" data-testid={`${testIdPrefix}-retry-${repo}`} onClick={prs.reload}>
                    Retry
                  </button>
                </>
              ) : (
                <span>{RESTING[reason]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Where `pr`'s story lives, workspace-relative (the QA tab's `?file=` form). */
const storyPath = (project: string, pr: Pick<PullRequest, "repo" | "number">) =>
  `${project}/qa/stories/${pr.repo}-pr-${pr.number}.md`;

/**
 * The project's story files, from the same file index the QA tab lists: read
 * on mount and again whenever the index changes on disk, so a finished
 * Explain turns its row's button into Story.
 */
function useStoryPaths(project: string): Set<string> {
  const files = useFileIndex();
  return useMemo(() => {
    const prefix = `${project}/qa/stories/`;
    return new Set(
      files.filter((f) => f.project === project && !f.archived && f.relativePath.startsWith(prefix)).map((f) => f.relativePath),
    );
  }, [files, project]);
}

const SparkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 1.5l1.6 3.4 3.4 1.6-3.4 1.6L8 11.5 6.4 8.1 3 6.5l3.4-1.6z" />
  </svg>
);
const BookIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M2 3h4.5A1.5 1.5 0 0 1 8 4.5V13a1.5 1.5 0 0 0-1.5-1.5H2zM14 3H9.5A1.5 1.5 0 0 0 8 4.5V13a1.5 1.5 0 0 1 1.5-1.5H14z" />
  </svg>
);
const RebuildIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />
  </svg>
);

interface StoryActionsProps {
  pr: PullRequest;
  story: string | null;
  /** The launch line, or null when the launcher is not ready. */
  line: string | null;
  /** Title for a launch: what it starts, or why it cannot. */
  launchTitle: string;
  /** Follows the row's roving tabindex, so the list stays a single tab stop. */
  tabbable: boolean;
  onLaunch: (line: string) => void;
  onStory: (path: string) => void;
}

/** Explain with no story yet; Story (opens it in the QA tab) and ↻ (rebuilds it) once one exists. */
function StoryActions({ pr, story, line, launchTitle, tabbable, onLaunch, onStory }: StoryActionsProps) {
  const launch = () => line && onLaunch(line);
  const tabIndex = tabbable ? 0 : -1;
  if (!story) {
    return (
      <button
        type="button"
        className="pr-act"
        data-testid={`pr-explain-${prKey(pr)}`}
        tabIndex={tabIndex}
        disabled={!line}
        title={launchTitle}
        onClick={launch}
      >
        <SparkIcon />
        Explain
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="pr-act pr-act-story"
        data-testid={`pr-story-${prKey(pr)}`}
        tabIndex={tabIndex}
        title={`Open qa/stories/${pr.repo}-pr-${pr.number}.md`}
        onClick={() => onStory(story)}
      >
        <BookIcon />
        Story
      </button>
      <button
        type="button"
        className="pr-act-icon"
        data-testid={`pr-rebuild-${prKey(pr)}`}
        tabIndex={tabIndex}
        aria-label={`Rebuild story for #${pr.number}`}
        disabled={!line}
        title={line ? "Rebuild story" : launchTitle}
        onClick={launch}
      >
        <RebuildIcon />
      </button>
    </>
  );
}

/** Full-width list of the project's open PRs under the remembered filter; no context switcher. */
export default function PrsView({ project, prs, filter, setFilter, params, setParams }: ReposViewProps) {
  const current = params.get("pr");
  const showingAll = (filter.preset === "all" || prs.identityUnknown) && filter.author === null;
  const [focused, setFocused] = useState<string | null>(null);
  const { revalidate } = prs;
  // The tab stays mounted: entering the view is when a remote change should show up.
  useEffect(() => revalidate(), [revalidate]);

  const stories = useStoryPaths(project);
  const projectLauncher = useProjectLauncher(project);
  const blockedReason = launcherBlockedReason(projectLauncher);
  const launchRun = useLaunchRun(project);
  const navigate = useNavigate();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const onLaunch = useCallback(
    (line: string) => {
      setLaunchError(null);
      launchRun(line).catch((err: unknown) => setLaunchError(err instanceof Error ? err.message : String(err)));
    },
    [launchRun],
  );
  const onStory = useCallback(
    (path: string) => navigate(`/project/${encodeURIComponent(project)}/qa?file=${encodeURIComponent(path)}`),
    [navigate, project],
  );
  const actionsFor = (p: PullRequest, tabbable: boolean): ReactNode => {
    // A PR whose repo is not a slug never reaches a prompt: no controls at all.
    if (!explainable(project, p.repo, p.number)) return null;
    const { launcher } = projectLauncher;
    const line = blockedReason === null && launcher ? explainRunLine(launcher, project, p.repo, p.number) : null;
    const path = storyPath(project, p);
    return (
      <StoryActions
        pr={p}
        story={stories.has(path) ? path : null}
        line={line}
        tabbable={tabbable}
        launchTitle={
          blockedReason ?? `Start ${launcher?.name ?? ""} running /pavilio-pr-explain ${project} ${p.repo}#${p.number}`
        }
        onLaunch={onLaunch}
        onStory={onStory}
      />
    );
  };

  if (prs.error) {
    return (
      <div className="prs-status" role="alert" data-testid="prs-view">
        Couldn't load pull requests ({prs.error}).{" "}
        <button type="button" data-testid="prs-retry" onClick={prs.reload}>
          Retry
        </button>
      </div>
    );
  }

  const keys = prs.prs.map(prKey);
  const active = [focused, current].find((k) => k && keys.includes(k)) ?? keys[0];

  let body: ReactNode;
  if (prs.loading && prs.me === null) body = <p className="prs-status">Loading pull requests…</p>;
  else if (prs.prs.length > 0)
    body = (
      <ul className="pr-list" role="listbox" aria-label="Open pull requests" onKeyDown={moveListFocus}>
        {prs.prs.map((p) => {
          const tabbable = prKey(p) === active;
          return (
            <PrRow
              key={prKey(p)}
              pr={p}
              me={prs.me}
              selected={prKey(p) === current}
              tabbable={tabbable}
              onFocus={() => setFocused(prKey(p))}
              // file/line belong to whatever was open before; the new PR starts at its first change.
              onOpen={(open) => setParams({ view: "review", pr: prKey(open), file: null, line: null })}
              actions={actionsFor(p, tabbable)}
            />
          );
        })}
      </ul>
    );
  else if (prs.all.length === 0) body = <p className="prs-empty">No open pull requests.</p>;
  else
    body = (
      <p className="prs-empty">
        No open pull requests match.
        {!showingAll && (
          <>
            {" "}
            <button type="button" data-testid="prs-show-all" onClick={() => setFilter({ preset: "all", author: null })}>
              Show all
            </button>
          </>
        )}
      </p>
    );

  return (
    <div data-testid="prs-view">
      <PrFilter
        project={project}
        me={prs.me}
        filter={filter}
        setFilter={setFilter}
        counts={prs.counts}
        authors={prs.authors}
        identityUnknown={prs.identityUnknown}
      />
      <PrsNotices prs={prs} />
      {body}
      {launchError && (
        <p className="prs-launch-error" role="alert" data-testid="prs-launch-error">
          Couldn't start the explain run: {launchError}
        </p>
      )}
    </div>
  );
}
