import { useMemo } from "react";
import { stripFrontmatter } from "../../lib/frontmatter";
import { SpeakingToolbar } from "../projects/ViewerActions";
import { prDescriptionSource, SpokenMarkdown } from "./PrDescription";
import "./Review.css";

/** Whether the review renders `path` as Markdown in Code mode. MDX is left as source: its JSX would render as text. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/**
 * A Markdown file as the review renders AND speaks it. Its frontmatter is
 * metadata, neither shown nor read; after that it is treated like a PR body
 * (HTML comments out, a leading `---` kept a rule).
 */
export function markdownFileSource(content: string): string {
  return prDescriptionSource(stripFrontmatter(content));
}

/**
 * The page a file's relative links resolve against: the file on GitHub at the
 * reviewed head. A PR URL of another shape gives `about:blank`, which no
 * relative URL resolves against — those links drop, absolute ones still work.
 */
export function fileBlobUrl(prUrl: string, head: string, path: string): string {
  return fileUrl(prUrl, "blob", head, path);
}

/** The file's raw bytes at the head: what its relative images resolve against (a blob page is HTML). */
export function fileRawUrl(prUrl: string, head: string, path: string): string {
  return fileUrl(prUrl, "raw", head, path);
}

function fileUrl(prUrl: string, kind: "blob" | "raw", head: string, path: string): string {
  const repo = /^(https?:\/\/[^?#]+)\/pull\/\d+\/?$/.exec(prUrl)?.[1];
  return repo ? `${repo}/${kind}/${encodeURIComponent(head)}/${path.split("/").map(encodeURIComponent).join("/")}` : "about:blank";
}

interface Props {
  /** The file's speech key: `${prSpeechKey}/f/${path}`. */
  speechKey: string;
  /** The whole file at head; undefined when it couldn't be loaded whole. */
  content: string | undefined;
  /** Shown instead of the rendering when `content` is missing; none when the review already says why above the viewer. */
  note?: string;
  linkBase: string;
  imageBase?: string;
}

/** A review's Markdown file in Code mode: rendered, with Play and play-from-here like the PR description. */
export default function ReviewMarkdownFile({ speechKey, content, note, linkBase, imageBase }: Props) {
  const source = content === undefined ? "" : markdownFileSource(content);
  const speech = useMemo(() => ({ key: speechKey, text: source }), [speechKey, source]);
  return (
    <section className="rv-card rv-mdfile" data-testid="review-md-rendered" aria-label="Rendered file">
      <SpeakingToolbar speech={speech} testIdPrefix="review-md">
        {(play) => play}
      </SpeakingToolbar>
      {content === undefined ? (
        note && <p className="rv-desc-empty">{note}</p>
      ) : source.trim() === "" ? (
        // Empty, or frontmatter and comments only.
        <p className="rv-desc-empty">Nothing to render.</p>
      ) : (
        <SpokenMarkdown docKey={speechKey} source={source} linkBase={linkBase} imageBase={imageBase} />
      )}
    </section>
  );
}
