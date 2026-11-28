import { Link, useNavigate } from "react-router-dom";
import PrRow, { PrIcon, prKey } from "../repos/PrRow";
import { forgeCopy } from "../repos/forgeCopy";
import { knownLogin } from "../repos/usePrs";
import { useStoryPr, type StoryPr, type StoryPrData, type StoryPrProblem } from "./useStoryPr";
import "../repos/Prs.css";
import "./StoryPrHeader.css";

/** The reduced row's short reason; `host` is the origin host the 502 named, when it named one. */
const PROBLEM: Record<StoryPrProblem, (host: string | null) => string> = {
  "gh-missing": () => "gh is not installed",
  "gh-unauthenticated": () => "gh is not authenticated",
  "glab-missing": () => "glab is not installed",
  "glab-unauthenticated": (host) => (host ? `Run glab auth login --hostname ${host}` : "Run glab auth login"),
  "unknown-forge": (host) => (host ? `Unknown forge for ${host}` : "Unknown forge"),
  failed: () => "Could not load PR status",
  unlinked: () => "Repo not linked",
  "project-missing": () => "Project not found",
};

const HEX_SHA = /^[0-9a-f]{7,40}$/i;

/** The PR head moved past the commit the story explains. An empty `headSha` says nothing, so no badge. */
function storyBehind(head: string | null, headSha: string): boolean {
  if (!head || !HEX_SHA.test(head) || !headSha) return false;
  return !headSha.toLowerCase().startsWith(head.toLowerCase());
}

const reviewRoute = (story: StoryPr) =>
  `/project/${encodeURIComponent(story.project)}/repos?view=review&pr=${encodeURIComponent(prKey(story))}`;

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />
  </svg>
);

interface ActionsProps {
  /** The Review route; null when the repo is not linked or the project is missing (the Review view could not open it). */
  review: string | null;
  /** The PR's page on its forge, and which forge that is; only a successful fetch knows them. */
  link: Pick<StoryPrData, "url" | "forge"> | null;
  loading: boolean;
  onRefresh: () => void;
}

function Actions({ review, link, loading, onRefresh }: ActionsProps) {
  const forge = link && forgeCopy(link.forge).name;
  return (
    <>
      {review && (
        <Link className="pr-act" to={review}>
          Review
        </Link>
      )}
      {link && (
        <a className="pr-act" href={link.url} target="_blank" rel="noreferrer" title={`Open on ${forge}`}>
          {forge} ↗
        </a>
      )}
      <button
        type="button"
        className={`pr-act-icon${loading ? " story-pr-spin" : ""}`}
        data-testid="story-pr-refresh"
        aria-label="Refresh PR status"
        title="Refresh PR status"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshIcon />
      </button>
    </>
  );
}

const LangTag = ({ lang }: { lang: StoryPr["lang"] }) =>
  lang ? (
    <span className="pr-badge story-pr-lang" title={lang === "pl" ? "Story in Polish" : "Story in English"}>
      {lang.toUpperCase()}
    </span>
  ) : null;

function badges(story: StoryPr, pr: StoryPrData) {
  return (
    <>
      {pr.state === "merged" && <span className="pr-badge pr-badge-merged">Merged</span>}
      {pr.state === "closed" && <span className="pr-badge pr-badge-closed">Closed</span>}
      {storyBehind(story.head, pr.headSha) && (
        <span
          className="pr-badge pr-badge-behind"
          title={`The PR head moved past the commit this story explains (${(story.head as string).slice(0, 7)})`}
        >
          Story behind
        </span>
      )}
      <LangTag lang={story.lang} />
    </>
  );
}

/**
 * The story PR header: the story's PR as the PRs list draws it, live from
 * `/api/prs/one`, with Review, a link to its forge (GitHub ↗ / GitLab ↗) and ↻.
 * While loading, or when the PR cannot be had, a reduced row from the
 * frontmatter stands in for it; the story below renders either way.
 */
export default function StoryPrHeader({ story }: { story: StoryPr }) {
  const { pr, problem, host, loading, refresh } = useStoryPr(story.project, story.repo, story.number);
  const navigate = useNavigate();
  // Neither an unlinked repo nor a missing project can open in the Review view.
  const review = problem === "unlinked" || problem === "project-missing" ? null : reviewRoute(story);

  if (pr) {
    return (
      <div className="story-pr" data-testid="story-pr-header">
        <PrRow
          pr={pr}
          me={knownLogin()}
          state={pr.state}
          standalone
          onOpen={() => navigate(reviewRoute(story))}
          actions={<Actions review={review} link={pr} loading={loading} onRefresh={refresh} />}
          extraBadges={badges(story, pr)}
        />
      </div>
    );
  }

  return (
    <div className="story-pr" data-testid="story-pr-header">
      <div className="pr-row story-pr-reduced">
        <span className="pr-ic pr-ic-draft">
          <PrIcon />
        </span>
        <span className="pr-tt">{story.title ?? `${story.repo}#${story.number}`}</span>
        <span className="pr-right">
          <span className="pr-actions">
            <Actions review={review} link={null} loading={loading} onRefresh={refresh} />
          </span>
        </span>
        <span className="pr-meta">
          <span className="pr-repo">{story.repo}</span>
          {/* The frontmatter's `repo#n` key: no live PR, so no forge to write `!n` for. */}
          <span>#{story.number}</span>
          <LangTag lang={story.lang} />
          {/* One live region for the row's life: only its text changes, so the change is announced. */}
          <span className="story-pr-problem" role="status">
            {loading ? "Loading PR status…" : problem ? PROBLEM[problem](host) : ""}
          </span>
        </span>
      </div>
    </div>
  );
}
