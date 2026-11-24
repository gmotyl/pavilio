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
  const repo = /^(https?:\/\/[^?#]+)\/pull\/\d+\/?$/.exec(prUrl)?.[1];
  return repo ? `${repo}/blob/${encodeURIComponent(head)}/${path.split("/").map(encodeURIComponent).join("/")}` : "about:blank";
}

interface Props {
  /** The file's speech key: `${prSpeechKey}/f/${path}`. */
  speechKey: string;
  /** The whole file at head; undefined when it couldn't be loaded whole. */
  content: string | undefined;
  /** Shown instead of the rendering when `content` is missing. */
  note: string;
  linkBase: string;
}

/** A review's Markdown file in Code mode: rendered, with Play and play-from-here like the PR description. */
export default function ReviewMarkdownFile({ speechKey, content, note, linkBase }: Props) {
  const source = content === undefined ? "" : markdownFileSource(content);
  const speech = useMemo(() => ({ key: speechKey, text: source }), [speechKey, source]);
  return (
    <section className="rv-mdfile" data-testid="review-md-rendered" aria-label="Rendered file">
      <SpeakingToolbar speech={speech} testIdPrefix="review-md">
        {(play) => play}
      </SpeakingToolbar>
      {content === undefined ? (
        <p className="rv-desc-empty">{note}</p>
      ) : source.trim() === "" ? (
        <p className="rv-desc-empty">This file is empty.</p>
      ) : (
        <SpokenMarkdown docKey={speechKey} source={source} linkBase={linkBase} />
      )}
    </section>
  );
}
