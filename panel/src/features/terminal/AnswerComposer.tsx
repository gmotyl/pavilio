import { useState } from "react";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { preferences } from "../../preferences/declarations";
import { toast } from "../../lib/toast";
import { clearDraft, getDraft, setDraft } from "./composerDrafts";
import { imageFromClipboardItems, uploadPastedImage } from "./imagePaste";

/**
 * How far the composer may be dragged, and how far one arrow key moves it.
 *
 * The floor is one line plus the field's own padding — below that the box shows
 * less than what is being typed into it. The ceiling is deliberately short of
 * the pane: the composer eats the answer it is a reply to, and a field taller
 * than the text above it has stopped being a reply to it.
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
 * ## Why a pasted image goes the same way the terminal's does
 *
 * `imageFromClipboardItems` + `uploadPastedImage` are the terminal's own paste
 * pair, and the composer is their second caller rather than a second
 * implementation: the same POST, naming the same session, because the server
 * chowns the saved file to the OS user behind that session before the CLI can
 * read it. What differs is only where the path lands — spliced into the field
 * at the caret instead of written into the pty — and that it is spliced at all:
 * a path appended to the end would be in the wrong place in every reply that
 * says anything after "look at".
 *
 * The trailing space is the terminal handler's too (`terminal.paste(path + " ")`),
 * and for the same reason: the next word the user types must not run into the
 * filename.
 *
 * A failed upload says so. The terminal's handler can afford its silence — the
 * user is watching a pty that visibly did not change — but here the field would
 * simply sit there, and a paste that quietly did nothing is indistinguishable
 * from a clipboard that held nothing. `toast.error` is the panel's own way of
 * saying it, the one the file explorer's failed moves already use.
 *
 * ## Why Escape is not handled here
 *
 * It is handled by the pane's root, which already stops Escape from anywhere
 * inside it, closes the pane and keeps the key from the cell. A second handler
 * on the field would be a second `onClose` path for one keystroke and would
 * have to repeat the stop — so the field simply lets the key bubble the three
 * nodes to the root that owns it.
 *
 * ## Why the text is mirrored into a module store
 *
 * `useState` is the field's value, but it is not where the draft LIVES. The
 * pane is mounted only while it is open, so every Escape destroys this
 * component — and a reply is typically written in the middle of reading, with
 * a glance back at the terminal underneath. `composerDrafts` outlives the
 * mount, so the field is seeded from it and every change is written back to
 * it. The only thing that clears it is the send that consumed it: closing the
 * pane, a new answer arriving and unmounting all leave it exactly where it was.
 *
 * The seed is read once, as the initial state, because a cell's `sessionId` is
 * fixed for the life of its pane — a composer never changes which agent it is
 * replying to.
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
  // Seeded from the store, not from `""`: this mount may be the second one for
  // a pane the user closed mid-sentence.
  const [text, setText] = useState(() => getDraft(sessionId));
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
    // The one thing that consumes a draft. Nothing else in this file — or in
    // the pane above it — calls `clearDraft`.
    clearDraft(sessionId);
    setText("");
    send(`${text}\r`);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const image = imageFromClipboardItems(e.clipboardData?.items);
    // No image in the clipboard: the textarea's own paste is exactly right,
    // so there is nothing to prevent and nothing to upload.
    if (!image) return;
    e.preventDefault();
    // Read off the event's target NOW: the upload is a round trip, and by the
    // time it answers `currentTarget` is null and the selection has moved.
    const from = e.currentTarget.selectionStart;
    const to = e.currentTarget.selectionEnd;
    void uploadPastedImage(image, sessionId).then((path) => {
      if (path === null) {
        toast.error("Could not save the pasted image");
        return;
      }
      // Functional, because the user may have kept typing while the upload was
      // in flight: what is spliced is the field as it is now, not as it was.
      // The draft is written from inside the updater for the same reason —
      // `next` is the only place the spliced value exists, and reading `text`
      // out here would store the string the paste started from. React may
      // invoke an updater twice under StrictMode; it is handed the same `prev`
      // both times, so the write is the same write.
      setText((prev) => {
        const next = `${prev.slice(0, from)}${path} ${prev.slice(to)}`;
        setDraft(sessionId, next);
        return next;
      });
    });
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
        onChange={(e) => {
          // Every keystroke goes to both: the state the field renders from,
          // and the store it will be rebuilt from after the pane is closed.
          setDraft(sessionId, e.target.value);
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    </div>
  );
}

export default AnswerComposer;
