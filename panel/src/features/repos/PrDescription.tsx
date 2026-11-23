import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { SpeakingToolbar } from "../projects/ViewerActions";
import { docSpeechKey } from "../speech/docKey";
import { PagePlayFromHere } from "../speech/PagePlayFromHere";
import type { PullRequest } from "./usePrs";
import "./Review.css";

/**
 * The PR description's speech key. Its first segment is the project, so the
 * description speaks in that project's voice (`projectOfDocKey`). The empty
 * segment after it is what no projects-relative file path can carry, so the
 * key never collides with a workspace note's — the two would otherwise share,
 * and prune, one page audio cache.
 */
export function prSpeechKey(project: string, pr: Pick<PullRequest, "repo" | "number">): string {
  return docSpeechKey(`${project}//pr/${pr.repo}/${pr.number}`);
}

/** Code spans and fences (kept verbatim), or an HTML comment (dropped; an unclosed one runs to the end, as on GitHub). */
const CODE_OR_COMMENT = /(`+)[\s\S]*?\1|(~{3,})[\s\S]*?\2|<!--[\s\S]*?(?:-->|$)/g;

/**
 * The PR body as the column renders AND speaks it — one text, so the toolbar,
 * the speech host and play-from-here always agree on its units:
 * - HTML comments go (PR templates hide their prompts in them; the renderer
 *   skips them too), except inside code;
 * - a leading `---` is a horizontal rule in a PR body, not note frontmatter, so
 *   a blank first line keeps page speech from stripping the text after it.
 */
export function prDescriptionSource(body: string): string {
  const text = body.replace(CODE_OR_COMMENT, (m) => (m.startsWith("<!--") ? "" : m));
  return /^\uFEFF?---/.test(text) ? `\n${text}` : text;
}

interface Props {
  project: string;
  pr: PullRequest;
  /** The PR body as markdown; null while it loads, "" when the PR has none, undefined when it couldn't be loaded. */
  body: string | null | undefined;
}

/** The review's right column: the PR description, rendered and readable aloud like a notes page. */
export default function PrDescription({ project, pr, body }: Props) {
  const source = typeof body === "string" ? prDescriptionSource(body) : body;
  const speech = { key: prSpeechKey(project, pr), text: source ?? "" };
  return (
    <aside className="rv-desc" aria-label="Pull request description">
      <SpeakingToolbar speech={speech} testIdPrefix="pr-description">
        {(play) => (
          <>
            <h4 className="rv-desc-title">Description</h4>
            {play}
          </>
        )}
      </SpeakingToolbar>
      {source === undefined ? (
        <p className="rv-desc-empty">Couldn't load the description.</p>
      ) : source === null ? (
        <p className="rv-desc-empty">Loading description…</p>
      ) : source.trim() === "" ? (
        <p className="rv-desc-empty">No description provided.</p>
      ) : (
        <PagePlayFromHere docKey={speech.key} text={speech.text}>
          <MarkdownRenderer content={source} untrusted={{ linkBase: pr.url }} />
        </PagePlayFromHere>
      )}
    </aside>
  );
}
