import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { highlightLines } from "./highlight";
import { HLJS_CLASS, numberStoryDiff, storyDiffLanguage, type StoryDiffLine } from "./storyDiff";
import { noteHits } from "./noteTarget";
import { NO_STORE, NoteHitContext, useBlockHit, type NoteHit, type StoryNote } from "./storyNotes";

/** Kinds whose first character is a diff prefix, so the rest is code. */
const CODE_KINDS = new Set<StoryDiffLine["kind"]>(["context", "added", "removed"]);

/**
 * Highlighted HTML per story line (null for a header or other non-code line), or null when the block
 * keeps the whole-line diff colouring: an unknown language, or a block too large to highlight. The code
 * lines, without their prefix, are highlighted as one text so multi-line tokens stay right.
 */
function colourStoryDiff(lines: StoryDiffLine[]): Array<string | null> | null {
  const lang = storyDiffLanguage(lines);
  if (!lang) return null;
  const code = lines.filter((line) => CODE_KINDS.has(line.kind));
  const { html, tokens } = highlightLines(code.map((line) => line.text.slice(1)), lang);
  if (!tokens) return null;
  let next = 0;
  return lines.map((line) => (CODE_KINDS.has(line.kind) ? html[next++] : null));
}

const HIT_CLASS = " story-line-hit";

/**
 * A numbered story `diff` block. The numbers live in `data-line` and are drawn by CSS
 * (`.diff-line::before`), so selecting and copying the code never picks them up; the copy button
 * reads the original children in the `pre` override. Rows a hovered note names get `story-line-hit`.
 */
export function StoryDiffCode({ text, block, className, codeProps }: { text: string; block: number | undefined; className?: string; codeProps: Record<string, unknown> }) {
  // Highlighting is the costly part, so it runs again only when the block's text changes.
  const { lines, coloured } = useMemo(() => {
    const numbered = numberStoryDiff(text) ?? [];
    return { lines: numbered, coloured: colourStoryDiff(numbered) };
  }, [text]);
  const target = useBlockHit(block);
  const hitClass = (line: StoryDiffLine) => (target && noteHits(target, line) ? HIT_CLASS : "");
  if (coloured) {
    return (
      <code className={className} {...codeProps}>
        {lines.map((line, i) => {
          const code = coloured[i];
          if (code === null) {
            return (
              <span key={i} className={`diff-line${hitClass(line)}`} data-line={line.number ?? ""}>
                {line.text}
                {"\n"}
              </span>
            );
          }
          const tint = line.kind === "added" ? " story-line-added" : line.kind === "removed" ? " story-line-removed" : "";
          return (
            <span key={i} className={`diff-line story-line${tint}${hitClass(line)}`} data-line={line.number ?? ""} data-base={line.base ?? ""}>
              {/* The sign is the line's own prefix, as text, so selecting the block still copies the diff. */}
              <span className="story-line-sign">{line.text.slice(0, 1)}</span>
              <span className="story-line-code" dangerouslySetInnerHTML={{ __html: code }} />
              {"\n"}
            </span>
          );
        })}
      </code>
    );
  }
  return (
    <code className={className} {...codeProps}>
      {lines.map((line, i) => {
        const hljs = HLJS_CLASS[line.kind];
        return (
          <span key={i} className={`diff-line${hitClass(line)}`} data-line={line.number ?? ""} data-base={line.base ?? ""}>
            {hljs ? <span className={hljs}>{line.text}</span> : line.text}
            {"\n"}
          </span>
        );
      })}
    </code>
  );
}

/**
 * A note bound to the story block above it: hovering it, or focusing inside it (its bold label is
 * focusable), lights the rows its label names; leaving or blurring clears them.
 */
export function StoryNoteItem({ note, children, liProps }: { note: StoryNote; children: ReactNode; liProps: Record<string, unknown> }) {
  const store = useContext(NoteHitContext) ?? NO_STORE;
  const { block } = note;
  const { side, from, to } = note.target;
  const hit = useMemo<NoteHit>(() => ({ block, target: { side, from, to } }), [block, side, from, to]);
  const light = () => store.set(hit);
  const clear = () => store.clear(hit);
  // A lit note that a re-render removes (or re-targets) never sees its mouse leave: unlight it here.
  useEffect(() => () => store.clear(hit), [store, hit]);
  return (
    <li {...liProps} data-note-target={note.label} onMouseEnter={light} onMouseLeave={clear} onFocus={light} onBlur={clear}>
      {children}
    </li>
  );
}
