import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Unavailable } from "../../../server/lib/prs/provider";
import { preferences, type StoryLanguage } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { useFileIndexState } from "../explorer/useFileIndex";
import { explainable, explainRunLine } from "../projects/runPrompt";
import { useLaunchRun } from "../projects/useLaunchRun";
import { launcherBlockedReason, useProjectLauncher } from "../projects/useProjectLauncher";
import { forgeCopy } from "./forgeCopy";
import PrFilter from "./PrFilter";
import { settleExplaining, startExplaining, useExplaining, type Explaining } from "./explainingStore";
import PrRow, { moveListFocus, prKey } from "./PrRow";
import { StoryLanguageMenu } from "./StoryLanguageMenu";
import type { ReposViewProps } from "./types";
import type { PrsState, PullRequest } from "./usePrs";
import "./Prs.css";

/** Why a repo lists no PRs and how to fix it; `host` is the origin host when the server knows it. */
const RESTING: Record<Exclude<Unavailable, "failed">, (host: string | undefined) => ReactNode> = {
  "unknown-forge": (host) =>
    host ? (
      <>
        Unknown forge for <code>{host}</code> — run <code>glab auth login --hostname {host}</code> or set{" "}
        <code>forge</code> in repos.json
      </>
    ) : (
      // No usable origin URL: resolution stops before the forge override, so only the remote fixes it.
      <>
        No usable <code>origin</code> remote — add or fix it
      </>
    ),
  "gh-missing": () => (
    <>
      <code>gh</code> is not installed
    </>
  ),
  "gh-unauthenticated": () => (
    <>
      Run <code>gh auth login</code>
    </>
  ),
  "glab-missing": () => (
    <>
      <code>glab</code> is not installed
    </>
  ),
  "glab-unauthenticated": (host) => (
    <>
      Run <code>{host ? `glab auth login --hostname ${host}` : "glab auth login"}</code>
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
          {prs.unavailable.map(({ repo, reason, host }) => (
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
                <span>{RESTING[reason](host)}</span>
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
 * The project's story files with their index `modified` times, from the same
 * file index the QA tab lists: read on mount and again whenever the index
 * changes on disk, so a finished Explain turns its row's button into Story and
 * a rewritten story ends a rebuild's spinner. `stories` is null until the index has loaded
 * once: an empty placeholder would read as "no story" and offer Explain for a
 * PR that has one. `indexError` says the load failed and is being retried.
 */
function useStoryPaths(project: string): { stories: Map<string, number> | null; indexError: boolean } {
  const { files, loaded, error } = useFileIndexState();
  const stories = useMemo(() => {
    if (!loaded) return null;
    const prefix = `${project}/qa/stories/`;
    return new Map(
      files
        .filter((f) => f.project === project && !f.archived && f.relativePath.startsWith(prefix))
        .map((f) => [f.relativePath, f.modified]),
    );
  }, [files, loaded, project]);
  return { stories, indexError: error };
}

/** Why Explain / ↻ cannot launch yet: the file index has not said which PRs have a story. */
const LOADING_STORIES = "Loading stories…";
/** The same wait after the index failed to load: it is retried on a backoff. */
const STORIES_RETRYING = "Couldn't load stories — retrying…";

/**
 * How often a live explaining entry is re-checked with no file change: the
 * timeout and the "started N min ago" title move on the clock alone.
 */
const SETTLE_EVERY_MS = 30_000;

/**
 * Feeds the explaining store from the file index — under the store's keys
 * (`repo#n`), each story's `modified` — on every index change, and on a timer
 * while any of the project's entries is still waiting, so the 15-minute
 * timeout shows even when no file ever changes. Returns the clock the titles
 * read, which the same timer advances.
 */
function useSettleExplaining(
  project: string,
  prs: readonly PullRequest[],
  stories: Map<string, number> | null,
  explaining: ReadonlyMap<string, Explaining>,
): number {
  const storyModified = useMemo(() => {
    // Not loaded yet: nothing to settle against.
    if (!stories) return null;
    const m = new Map<string, number>();
    for (const p of prs) {
      const modified = stories.get(storyPath(project, p));
      if (modified !== undefined) m.set(prKey(p), modified);
    }
    return m;
  }, [prs, stories, project]);
  const latest = useRef(storyModified);
  useEffect(() => {
    latest.current = storyModified;
    if (storyModified) settleExplaining(project, storyModified);
  }, [project, storyModified]);

  const [now, setNow] = useState(Date.now);
  const waiting = [...explaining.values()].some((e) => !("timedOut" in e));
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
      if (latest.current) settleExplaining(project, latest.current);
    }, SETTLE_EVERY_MS);
    return () => clearInterval(id);
  }, [project, waiting]);
  return now;
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
  /** The launch line, or null when the launcher is not ready or a launch is pending. */
  line: string | null;
  /** Title for a launch: what it starts, or why it cannot. */
  launchTitle: string;
  /**
   * A launch is pending somewhere in the list. Like a running story it leaves
   * the main half inert via `aria-disabled` rather than `disabled`, so a button
   * launched from the keyboard keeps focus and the list's arrow keys.
   */
  pending: boolean;
  /** Follows the row's roving tabindex, so the list stays a single tab stop. */
  tabbable: boolean;
  lang: StoryLanguage;
  onLang: (lang: StoryLanguage) => void;
  /** The row's entry in the explaining store, if any. */
  explaining: Explaining | undefined;
  /** The clock `explaining`'s "started N min ago" is measured against. */
  now: number;
  onLaunch: (line: string) => void;
  onStory: (path: string) => void;
}

const TIMEOUT_NOTE = "No story after 15 min — check the run in iterm.";

const LANGUAGE_CODE: Record<StoryLanguage, string> = { en: "EN", pl: "PL" };

/**
 * Explain with no story yet; Story (opens it in the QA tab) and ↻ (rebuilds it)
 * once one exists. Explain and ↻ are split buttons whose right half picks the
 * story language. While the row's story is being written the main half spins
 * (inert but focusable) and the language half is disabled; a run that never
 * produced one leaves a note.
 */
function StoryActions({
  pr,
  story,
  line,
  launchTitle,
  pending,
  tabbable,
  lang,
  onLang,
  explaining,
  now,
  onLaunch,
  onStory,
}: StoryActionsProps) {
  const tabIndex = tabbable ? 0 : -1;
  const running = explaining && !("timedOut" in explaining) ? explaining : null;
  const timedOut = explaining !== undefined && "timedOut" in explaining;
  const busy = pending || running !== null;
  const launch = () => {
    if (line && !busy) onLaunch(line);
  };
  // `disabled` only for a launcher that cannot start anything; busy is aria-disabled.
  const inert = { disabled: !line, "aria-disabled": busy || undefined } as const;

  let main: ReactNode;
  if (running) {
    const mins = Math.max(0, Math.floor((now - running.startedAt) / 60_000));
    main = (
      <button
        type="button"
        className="pr-act"
        data-testid={`pr-explaining-${prKey(pr)}`}
        tabIndex={tabIndex}
        aria-disabled="true"
        title={`Writing the story (${LANGUAGE_CODE[running.lang]}) — started ${mins} min ago`}
      >
        <span className="pr-spin" aria-hidden="true" />
        Explaining…
      </button>
    );
  } else if (!story) {
    main = (
      <button
        type="button"
        className="pr-act"
        data-testid={`pr-explain-${prKey(pr)}`}
        tabIndex={tabIndex}
        {...inert}
        title={launchTitle}
        onClick={launch}
      >
        <SparkIcon />
        Explain
      </button>
    );
  } else {
    main = (
      <button
        type="button"
        className="pr-act-icon"
        data-testid={`pr-rebuild-${prKey(pr)}`}
        tabIndex={tabIndex}
        aria-label={`Rebuild story for ${forgeCopy(pr.forge).number(pr.number)}`}
        {...inert}
        title={line ? "Rebuild story" : launchTitle}
        onClick={launch}
      >
        <RebuildIcon />
      </button>
    );
  }

  return (
    <>
      {story && (
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
      )}
      <span className="pr-split">
        {main}
        <StoryLanguageMenu
          lang={lang}
          onPick={onLang}
          disabled={running !== null}
          tabIndex={tabIndex}
          testId={`pr-lang-${prKey(pr)}`}
        />
      </span>
      {timedOut && (
        // Clamped to two lines in a very narrow pane; the title keeps the whole note.
        <span className="pr-hint" role="status" title={TIMEOUT_NOTE}>
          {TIMEOUT_NOTE}
        </span>
      )}
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

  const { stories, indexError } = useStoryPaths(project);
  const explaining = useExplaining(project);
  const now = useSettleExplaining(project, prs.all, stories, explaining);
  const [lang, setLang] = usePreference(preferences.storyLanguage);
  const projectLauncher = useProjectLauncher(project);
  const blockedReason = launcherBlockedReason(projectLauncher);
  const launchRun = useLaunchRun(project);
  const navigate = useNavigate();
  const [launchError, setLaunchError] = useState<string | null>(null);
  // One launch at a time: while one is pending every Explain/↻ is disabled, so
  // repeated clicks cannot start a second terminal and story run.
  const [launching, setLaunching] = useState(false);
  // The row waits for its story only once the launch has resolved: a launch
  // that failed started nothing, so it shows the error line and no spinner.
  const onLaunch = useCallback(
    (key: string, line: string, run: { lang: StoryLanguage; kind: "explain" | "rebuild" }) => {
      setLaunchError(null);
      setLaunching(true);
      launchRun(line)
        .then(() => startExplaining(project, key, run))
        .catch((err: unknown) => setLaunchError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLaunching(false));
    },
    [launchRun, project],
  );
  const onStory = useCallback(
    (path: string) => navigate(`/project/${encodeURIComponent(project)}/qa?file=${encodeURIComponent(path)}`),
    [navigate, project],
  );
  const actionsFor = (p: PullRequest, tabbable: boolean): ReactNode => {
    // A PR whose repo is not a slug never reaches a prompt: no controls at all.
    if (!explainable(project, p.repo, p.number)) return null;
    const { launcher } = projectLauncher;
    // Until the index loads, a PR's story is unknown: nothing may launch (an Explain
    // over an existing story would be settled by that old file at once).
    const line =
      stories && blockedReason === null && launcher
        ? explainRunLine(launcher, project, p.repo, p.number, lang)
        : null;
    const path = storyPath(project, p);
    const story = stories?.has(path) ? path : null;
    const key = prKey(p);
    return (
      <StoryActions
        pr={p}
        story={story}
        line={line}
        pending={launching}
        tabbable={tabbable}
        launchTitle={
          (stories ? null : indexError ? STORIES_RETRYING : LOADING_STORIES) ??
          blockedReason ??
          `Start ${launcher?.name ?? ""} running pavilio-pr-explain for ${project} ${p.repo}#${p.number}`
        }
        lang={lang}
        onLang={setLang}
        explaining={explaining.get(key)}
        now={now}
        onLaunch={(l) => onLaunch(key, l, { lang, kind: story ? "rebuild" : "explain" })}
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
    <div className="prs-view" data-testid="prs-view">
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
