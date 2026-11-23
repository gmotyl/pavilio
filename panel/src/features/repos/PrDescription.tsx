import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { SpeakingToolbar } from "../projects/ViewerActions";
import { docSpeechKey } from "../speech/docKey";
import { PagePlayFromHere } from "../speech/PagePlayFromHere";
import type { PullRequest } from "./usePrs";
import "./Review.css";

/**
 * The PR description's speech key. Its first segment is the project, so the
 * description speaks in that project's voice (`projectOfDocKey`); the rest only
 * has to be unique per PR — no file lives at this path.
 */
export function prSpeechKey(project: string, pr: Pick<PullRequest, "repo" | "number">): string {
  return docSpeechKey(`${project}/prs/${pr.repo}/${pr.number}.md`);
}

interface Props {
  project: string;
  pr: PullRequest;
  /** The PR body as markdown; null while it loads, "" when the PR has none, undefined when it couldn't be loaded. */
  body: string | null | undefined;
}

/** The review's right column: the PR description, rendered and readable aloud like a notes page. */
export default function PrDescription({ project, pr, body }: Props) {
  const speech = { key: prSpeechKey(project, pr), text: body ?? "" };
  return (
    <aside className="rv-desc" aria-label="Pull request description">
      <SpeakingToolbar speech={speech} testIdPrefix="pr-description">
        {(play) => (
          <>
            <h4>Description</h4>
            {play}
          </>
        )}
      </SpeakingToolbar>
      {body === undefined ? (
        <p className="rv-desc-empty">Couldn't load the description.</p>
      ) : body === null ? (
        <p className="rv-desc-empty">Loading description…</p>
      ) : body.trim() === "" ? (
        <p className="rv-desc-empty">No description provided.</p>
      ) : (
        <PagePlayFromHere docKey={speech.key} text={speech.text}>
          <MarkdownRenderer content={body} />
        </PagePlayFromHere>
      )}
    </aside>
  );
}
