import { fromMarkdown } from "mdast-util-from-markdown";
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

/** The slice of an mdast node this file reads. */
interface MdNode {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
}

/** Source ranges of the body's HTML comments, as the markdown parser reads them (escapes and code excluded). */
function commentRanges(body: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const walk = (node: MdNode) => {
    if (node.type === "html" && node.value?.trimStart().startsWith("<!--")) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) out.push([start, end]);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(fromMarkdown(body));
  return out;
}

/**
 * The PR body as the column renders AND speaks it — one text, so the toolbar,
 * the speech host and play-from-here always agree on its units:
 * - HTML comments go (PR templates hide their prompts in them). They are found
 *   by the markdown parser, so an escaped `\<!--` or a comment shown in code
 *   stays exactly as written;
 * - a leading `---` is a horizontal rule in a PR body, not note frontmatter, so
 *   a blank first line keeps page speech from stripping the text after it.
 */
export function prDescriptionSource(body: string): string {
  let text = body;
  // Back to front, so earlier offsets stay valid.
  for (const [start, end] of commentRanges(body).reverse()) text = text.slice(0, start) + text.slice(end);
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
