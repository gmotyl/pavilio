import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";

/** Blocks that are not prose: headings, quotes, tables, rules, lists, HTML. */
const NON_PARAGRAPH = /^(#{1,6}\s|>|\||-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|[-*+]\s|\d+[.)]\s|<)/;

/**
 * The first prose paragraph of a markdown document, as plain text on one line.
 *
 * Headings, block quotes (the "Last updated" stamp), tables, lists, code fences
 * and front matter are skipped — the peek should say what the project *is*, and
 * those blocks rarely do. Inline syntax is stripped down to its visible text.
 * Returns `""` when the document has no paragraph at all.
 */
export function firstParagraph(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  // Front matter only counts at the very top.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, n) => n > 0 && line.trim() === "---");
    if (end > 0) i = end + 1;
  }
  let inFence = false;
  const paragraph: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) {
      if (paragraph.length) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      if (paragraph.length) break;
      continue;
    }
    if (!paragraph.length && NON_PARAGRAPH.test(line)) continue;
    paragraph.push(line);
  }
  return paragraph
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/\*([^*\s][^*]*?)\*/g, "$1")
    .replace(/\b_([^_]+)_\b/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Props {
  /** `null` while loading or after an error. */
  content: string | null;
  error: string | null;
  basePath: string;
}

/**
 * PROJECT.md on the Overview tab, collapsed to a one-line peek.
 *
 * The header is the toggle; "Show"/"Hide" on its right says which way the
 * click goes. The open state is deliberately local and unpersisted: the tab
 * opens collapsed on every visit, so the settings below stay in view.
 *
 * Loading and error states are not hidden behind the toggle — they render in
 * the peek's place, so a broken PROJECT.md is visible without a click.
 */
export default function CollapsibleProjectMd({ content, error, basePath }: Props) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const peek = content === null ? "" : firstParagraph(content);

  return (
    <section
      data-testid="project-md"
      className="rounded-lg mb-4"
      style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)" }}
    >
      <button
        data-testid="project-md-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
        style={{ color: "var(--text-primary)" }}
      >
        <ChevronRight
          aria-hidden="true"
          className={`w-3.5 h-3.5 flex-none transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          style={{ color: "var(--text-secondary)" }}
        />
        <span className="text-sm font-semibold">PROJECT.md</span>
        <span className="ml-auto text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {error && (
        <p className="text-sm px-3.5 pb-3 pl-9" style={{ color: "var(--red)" }}>
          Failed to load PROJECT.md: {error}
        </p>
      )}
      {!error && content === null && (
        <p className="text-sm px-3.5 pb-3 pl-9" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      )}
      {content !== null && !open && peek && (
        <p
          data-testid="project-md-peek"
          className="truncate text-[13px] px-3.5 pb-3 pl-9"
          style={{ color: "var(--text-secondary)" }}
        >
          {peek}
        </p>
      )}
      {content !== null && open && (
        <div
          id={bodyId}
          className="px-4 pt-1 pb-4 pl-9"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <MarkdownRenderer content={content} basePath={basePath} />
        </div>
      )}
    </section>
  );
}
