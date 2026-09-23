import { useState } from "react";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { preferences } from "../../preferences/declarations";

/**
 * How far the composer may be dragged, and how far one arrow key moves it.
 *
 * The floor is one line plus the field's own padding — below that the box shows
 * less than what is being typed into it. The ceiling is deliberately short of
 * the pane: the composer eats the answer it is a reply to, and a field taller
 * than the text above it has stopped being a footer.
 */
const BOUNDS: RowBounds = { min: 40, max: 320, step: 12 };

export interface AnswerComposerProps {
  sessionId: string;
  /**
   * The cell's own PTY write — `TerminalView`'s `send`, read off the live
   * instance at call time, the same one the bar's launcher pills use.
   */
  send: (data: string) => void;
}

/**
 * The text field at the foot of the answer pane: a reply typed where the answer
 * is read, written straight to the cell's PTY.
 *
 * ## Why Enter sends and Shift+Enter does not
 *
 * The field is a reply to an agent, not a document: the overwhelmingly common
 * case is one line and a return, which is why Enter is the send key and carries
 * the `\r` the TUI submits on. Shift+Enter is left entirely alone — no
 * `preventDefault`, no handler — so the textarea's OWN newline insertion does
 * the multi-line case, caret position and undo stack included. A handler that
 * spliced a `\n` in by hand would have to reimplement both and would still lose
 * the browser's undo.
 *
 * An empty field swallows the Enter rather than sending a bare return: a return
 * with nothing in front of it reaches the agent as a prompt containing nothing,
 * which is the one thing a stray keystroke must not be able to do. Whitespace
 * counts as empty for the same reason — but what is SENT is never trimmed: the
 * text is the user's, and leading indentation in a pasted snippet is theirs too.
 *
 * ## Why Escape is not handled here
 *
 * It is handled by the pane's root, which already stops Escape from anywhere
 * inside it, closes the pane and keeps the key from the cell. A second handler
 * on the field would be a second `onClose` path for one keystroke and would
 * have to repeat the stop — so the field simply lets the key bubble the three
 * nodes to the root that owns it.
 *
 * ## Why the height is the row hook's and not a CSS constant
 *
 * `useResizableRow(answerComposerHeight, BOUNDS)` with a `PaneResizer` on the
 * `top` edge: dragging upward grows the field into the answer above it, which
 * is the only direction there is room in. The hook reports `isMobile` but
 * applies nothing — the consumer decides — and here that decision is the whole
 * of the mobile case: no grip (an 8px rail under the thumb that is scrolling
 * the pane), no stored height at all, and a single row laid out by the viewport.
 */
export function AnswerComposer({ sessionId, send }: AnswerComposerProps) {
  const [text, setText] = useState("");
  const { height, isMobile, handleProps } = useResizableRow(
    preferences.answerComposerHeight,
    BOUNDS,
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Shift+Enter is the textarea's own business, and so is every other key.
    if (e.key !== "Enter" || e.shiftKey) return;
    // Enter never types in this field, empty or not: a newline that appeared
    // when the send was swallowed would leave the next line indented by a
    // keystroke the user meant as "send".
    e.preventDefault();
    if (text.trim() === "") return;
    setText("");
    send(`${text}\r`);
  };

  return (
    <div
      className="answer-pane-composer"
      // The positioning context the grip's `absolute top-0` is measured from,
      // and — on desktop only — the row's height. On a touch viewport the
      // stored number is not applied at all: the field is one row and the
      // viewport lays the pane out.
      style={isMobile ? undefined : { height: `${height}px` }}
    >
      {/* Renders nothing on a touch viewport — `handleProps` carries the
          verdict and the rail hides itself, which is the primitive's own rule
          rather than a second copy of it here. */}
      <PaneResizer name="composer" edge="top" label="Resize the composer" {...handleProps} />
      <textarea
        className="answer-pane-composer-field"
        data-testid={`answer-pane-composer-${sessionId}`}
        aria-label="Reply to this cell"
        placeholder="Reply…"
        rows={isMobile ? 1 : 2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

export default AnswerComposer;
