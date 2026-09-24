import { useState } from "react";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { preferences } from "../../preferences/declarations";
import { toast } from "../../lib/toast";
import { clearDraft, getDraft, setDraft } from "./composerDrafts";
import { imageFromClipboardItems, uploadPastedImage } from "./imagePaste";
import { submitToPty, type SubmitFailure } from "./ptySubmit";
import { projectOfSession } from "./sessionProject";
import { sendDismiss } from "./terminalInstances";
import { getActivityState } from "./useTerminalActivityChannel";

/**
 * How far the composer may be dragged, and how far one arrow key moves it.
 *
 * The floor is one line plus the field's own padding — below that the box shows
 * less than what is being typed into it. The ceiling is deliberately short of
 * the pane: the composer eats the answer it is a reply to, and a field taller
 * than the text above it has stopped being a reply to it.
 */
const BOUNDS: RowBounds = { min: 40, max: 320, step: 12 };

/**
 * The user has arrived at this cell: clear its attention LED if one is lit.
 *
 * The caret landing in this field is the plainest arrival there is — the user
 * is not merely looking at the answer, they are typing a reply to it — and the
 * green "done" LED is a *check me* notification that is over once they have.
 * `TerminalsSurface.handleFocus` has said exactly this about a focused
 * terminal since the LED existed; this is the same sentence about the reply box.
 *
 * Only `attention` is dismissed. `busy` is the AGENT's state rather than a
 * message to the user, and clearing it because somebody started typing would
 * claim the agent had stopped working. `idle` has nothing to clear, so a frame
 * per focus would be traffic that changes nothing — and the field is focused
 * and re-focused constantly while a reply is written.
 *
 * Read imperatively rather than subscribed to: the answer is only needed inside
 * the focus handler, and the composer has no reason to re-render when a session
 * elsewhere goes busy. Twin of the same guard in `SpeechControlBar`.
 */
function dismissAttentionOnArrival(sessionId: string): void {
  if (getActivityState(sessionId) !== "attention") return;
  sendDismiss(sessionId);
}

/**
 * What the pane says when the socket refused one half of a submit.
 *
 * Two sentences, because the two failures leave the reply in two different
 * places and the user's next move differs. A refused BODY never left the
 * browser, so the text is back in the field and the whole of the news is that
 * it did not go. A refused RETURN left the body in the TUI's prompt with
 * nobody having pressed Enter on it — the field is legitimately empty, and
 * saying "not sent" there would be a lie that sent the user looking for text
 * that is sitting in the terminal underneath.
 */
const FAILURE_TEXT: Record<SubmitFailure, string> = {
  body: "Not sent — the terminal is not connected. Your reply is still here.",
  return: "Sent but not submitted — the terminal disconnected. The line is in the prompt below.",
};

/** The file a path ends in — the chip's whole text. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface AnswerComposerProps {
  sessionId: string;
  /**
   * The cell's own PTY write — `TerminalView`'s `send`, read off the live
   * instance at call time, the same one the bar's launcher pills use.
   *
   * The raw write, not a wrapped one: a submit is TWO writes now (see
   * `ptySubmit`), and anything the pane wants to do once per submit belongs in
   * {@link onSubmitted} rather than on a write it would then see twice.
   *
   * It reports whether the frame reached an OPEN socket, and this field is the
   * reason that boolean exists: a reply cleared on the strength of a write
   * that was silently dropped is a reply the user cannot get back.
   */
  send: (data: string) => boolean;
  /**
   * A draft has just gone out. Raised once per submit, after the body has been
   * written — the pane hands its body over to the waiting state here, because
   * it is the pane that knows which answer the draft was a reply to.
   */
  onSubmitted: () => void;
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

 * ## Why the return is not part of the text that is sent
 *
 * `submitToPty` writes the body, and then the `\r` on a turn of its own. The
 * composer used to send `` `${text}\r` `` as one write, which is one websocket
 * frame and one `pty.write` — and a TUI with bracketed paste enabled reads a
 * burst like that as a PASTE, trailing return included. The reply landed in the
 * prompt and sat there unsubmitted, which is the bug the split fixes; the whole
 * of the reasoning is on `ptySubmit`.
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
 * ## Why a refused send keeps the text
 *
 * The cell's `send` says whether the frame reached an OPEN socket. It used to
 * say nothing: a socket that was not OPEN took the guard, the write was
 * dropped in silence, `submitToPty` scheduled the return anyway and this field
 * cleared — so a reply typed while the socket was down was simply gone, with
 * no error and no way back to it. That is the bug Greg hit in use, and the
 * answer is the honest refusal rather than a queue: the text stays here, the
 * pane says it did not go, and the user resends it when the cell is back.
 *
 * Nothing is retried. `reconnectOnActivate` already repairs a dead socket the
 * moment the user goes near the cell (ADR 0010), so the resend costs a second
 * keypress — whereas a reply flushed on reconnect would arrive at whatever the
 * agent had moved on to, answering a prompt that is no longer on screen.
 *
 * The notice is a row of the pane, not a toast, and it carries `role="alert"`.
 * A refusal is about the text still in this field, so it belongs beside the
 * field; and it is the one thing here a sighted user learns from a colour, so
 * it has to be announced rather than merely drawn. It clears on the next
 * keystroke and on the next submit, because either one means the user has
 * already read it and moved.
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
 * ## Why there is a send button as well as a key
 *
 * `submit` is one function and both controls call it, so the button is not a
 * second path to the PTY — it is the same one with a pointer on it. It earns
 * its place on a phone, where Enter is the only key there is and a hint line
 * naming Shift+Enter would be describing a keyboard that is not there: the
 * hint and the grip drop on a touch viewport, and the button is what is left.
 *
 * ## Why the pasted-image chip is beside the field and not inside it
 *
 * design.md draws the chip INSIDE the well with the path still under it as
 * editable text. A `<textarea>` holds text, not elements, so that drawing
 * cannot be built as drawn without giving up the editing — and the editing is
 * the shipped behaviour Greg tested by hand and asked to keep (the path is
 * spliced at the caret; typing over it points the reply somewhere else). So
 * the chip stands above the field instead, and it is DERIVED from the text
 * rather than kept beside it: `pasted` records what the uploads put there, and
 * a chip is drawn only while its path is still in the reply. Edit the path
 * away and the chip goes with it, because there is no longer an attachment of
 * that name to name.
 *
 * ## Why the height is the row hook's and not a CSS constant
 *
 * `useResizableRow(answerComposerHeight, BOUNDS, project)` with a `PaneResizer`
 * on the `top` edge: dragging upward grows the field into the answer above it,
 * which is the only direction there is room in. The hook reports `isMobile` but
 * applies nothing — the consumer decides — and here that decision is the whole
 * of the mobile case: no grip (an 8px rail under the thumb that is scrolling
 * the pane), no hint, no stored height at all, and a single row laid out by the
 * viewport.
 *
 * ## Why the height's scope is looked up rather than passed in
 *
 * The height is remembered per PROJECT, and this component is handed a
 * `sessionId` and nothing else — as is the pane above it, and the four
 * surfaces above that. `projectOfSession` reads the tab's own session list,
 * which is where `LauncherPills` already gets the project for its
 * `pavilio-session-start` argument and for the same reason; the whole of the
 * reasoning — including what happens when the list cannot name one, which is
 * that the field opens at its declared height and stores nothing until it can
 * — is on that function.
 */
export function AnswerComposer({ sessionId, send, onSubmitted }: AnswerComposerProps) {
  // Seeded from the store, not from `""`: this mount may be the second one for
  // a pane the user closed mid-sentence.
  const [text, setText] = useState(() => getDraft(sessionId));
  /**
   * Every path this composer's own pastes have put in the field. NOT the list
   * of chips — see the note on the component: a chip is shown only while the
   * path it names is still in the text, so this is the raw record and the text
   * is what decides.
   */
  const [pasted, setPasted] = useState<readonly string[]>([]);
  /**
   * The half of the last submit the socket refused, or null when the last
   * submit went. Not a count and not a history: a second refusal replaces the
   * first, because what the user needs to know is the state of the reply that
   * is in front of them now.
   */
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  const { height, isMobile, handleProps } = useResizableRow(
    preferences.answerComposerHeight,
    BOUNDS,
    // The scope: a cell's reply box is as tall as the project's work wants it,
    // and a session id would be forgotten the next time the agent restarted.
    projectOfSession(sessionId),
  );

  /** The one way out of this field, whichever control asked for it. */
  const submit = (): void => {
    if (text.trim() === "") return;
    // The reply this submit is made of, held across the clear below so a
    // refusal has something to put back. `text` itself is the render's value
    // and would still be right here, but naming it says what it is for.
    const reply = text;
    // The one thing that consumes a draft. Nothing else in this file — or in
    // the pane above it — calls `clearDraft`.
    clearDraft(sessionId);
    setText("");
    setPasted([]);
    // The last submit's verdict is spent the moment a new one is made.
    setFailure(null);
    /**
     * Whether the body reached the socket. A refused body is reported
     * SYNCHRONOUSLY — `submitToPty` writes it inline unless this session
     * already has a submit in flight — so this flag is answered by the time
     * the call returns, which is what lets the handover below be skipped.
     */
    let delivered = true;
    // The body now, its submitting return on a later turn — never one write.
    submitToPty(sessionId, send, reply, (stage) => {
      setFailure(stage);
      if (stage !== "body") return;
      delivered = false;
      // Nothing left the browser, so the reply is this field's again. Written
      // back to the store as well as the state: the store is what the field is
      // rebuilt from, and a refusal must survive the pane being closed exactly
      // as an unsent draft does.
      setDraft(sessionId, reply);
      setText(reply);
    });
    // The waiting state means "the agent is working on what I just said". On a
    // refused body it said nothing, so there is nothing to wait for. The other
    // failure cannot be known in time — the return is written a turn later,
    // and by then the pane has already handed its body over — which is fair:
    // the reply IS on the far side, it simply has not been run.
    if (delivered) onSubmitted();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Shift+Enter is the textarea's own business, and so is every other key.
    if (e.key !== "Enter" || e.shiftKey) return;
    // Enter never types in this field, empty or not: a newline that appeared
    // when the send was swallowed would leave the next line indented by a
    // keystroke the user meant as "send".
    e.preventDefault();
    submit();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const image = imageFromClipboardItems(e.clipboardData?.items);
    // No image in the clipboard: the textarea's own paste is exactly right,
    // so there is nothing to prevent and nothing to upload.
    if (!image) return;
    e.preventDefault();
    // Read off the event's target NOW: the upload is a round trip, and by the
    // time it answers `currentTarget` is null and the selection may have moved.
    // `preventDefault` above suppressed the native insertion, so nothing moves
    // the caret on its own — but the user is free to keep typing, and does.
    const from = e.currentTarget.selectionStart;
    const to = e.currentTarget.selectionEnd;
    void uploadPastedImage(image, sessionId).then((path) => {
      if (path === null) {
        toast.error("Could not save the pasted image");
        return;
      }
      // Spliced into the field as it is NOW, not as it was when the paste was
      // made: the upload is a round trip and the user keeps typing across it,
      // so `text` — captured when this handler ran — is the wrong string.
      //
      // The store is what "now" is read from, rather than a `setText` updater's
      // `prev`. Every keystroke writes it (see `onChange`), so it holds the
      // same characters the field does, and reading it keeps both writes out
      // here where they are plain statements. An updater that called `setDraft`
      // would be a side effect inside a function React requires to be pure and
      // double-invokes under StrictMode.
      const base = getDraft(sessionId);
      const next = `${base.slice(0, from)}${path} ${base.slice(to)}`;
      setDraft(sessionId, next);
      setText(next);
      setPasted((prev) => (prev.includes(path) ? prev : [...prev, path]));
    });
  };

  /**
   * The chips to draw: a pasted path is an attachment for exactly as long as
   * it is still in the reply.
   */
  const attachments = pasted.filter((path) => text.includes(path));

  return (
    <>
      {/* The grip is its own 7px row now, between the switches and the field,
          rather than a rail floating on the composer's top edge. Desktop only,
          and gated HERE as well as inside the primitive: the row has a height
          of its own, so a mobile pane that rendered it would keep the 7px the
          hidden rail no longer fills. */}
      {isMobile ? null : (
        <div className="answer-pane-grip">
          <span className="answer-pane-grip-bar" aria-hidden />
          <PaneResizer name="composer" edge="top" label="Resize the composer" {...handleProps} />
        </div>
      )}
      <div
        className="answer-pane-composer"
        // The row's height on desktop. On a touch viewport the stored number is
        // not applied at all: the field is one row and the viewport lays the
        // pane out.
        style={isMobile ? undefined : { height: `${height}px` }}
      >
        <div className="answer-pane-composer-well">
          {attachments.length > 0 ? (
            <div className="answer-pane-composer-chips">
              {attachments.map((path, index) => (
                <span
                  key={path}
                  className="answer-pane-composer-chip"
                  data-testid={`answer-pane-attachment-${sessionId}-${index}`}
                  // The path is the chip's tooltip and the field's text; the
                  // basename is all the chip itself says.
                  title={path}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  {basename(path)}
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            className="answer-pane-composer-field"
            data-testid={`answer-pane-composer-${sessionId}`}
            aria-label="Reply to this cell"
            placeholder="Reply to the terminal…"
            rows={isMobile ? 1 : 2}
            value={text}
            onChange={(e) => {
              // Every keystroke goes to both: the state the field renders from,
              // and the store it will be rebuilt from after the pane is closed.
              setDraft(sessionId, e.target.value);
              setText(e.target.value);
              // Typing is the user having read the refusal and moved on; a
              // notice that outlived the reply it was about would go on
              // claiming the next one failed too.
              setFailure(null);
            }}
            onKeyDown={onKeyDown}
            // Arriving at the cell, in the most explicit form the panel has.
            // `onFocus` rather than the first keystroke: the reply is being
            // written from the moment the caret is here, and a notice the user
            // is demonstrably answering has already served its purpose.
            onFocus={() => dismissAttentionOnArrival(sessionId)}
            onPaste={onPaste}
          />
        </div>
        {/* The same `submit` Enter runs — not a second path to the PTY. On a
            phone it is the ONLY one: there is no Shift+Enter to explain, so the
            hint goes and the button carries the whole action. */}
        <button
          type="button"
          className="answer-pane-composer-send"
          data-testid={`answer-pane-send-${sessionId}`}
          aria-label="Send to terminal"
          onClick={submit}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {/* The refusal, in the pane rather than in a toast that floats over the
          corner of the window: it is about the text in the field above it. On
          every viewport, unlike the hint — a phone is exactly where a socket
          drops, and there is no second place there to notice it. `role="alert"`
          because the colour is what tells a sighted user, and a screen reader
          is not looking at the pane when a send is refused. */}
      {failure === null ? null : (
        <div
          className="answer-pane-send-failed"
          data-testid={`answer-pane-send-failed-${sessionId}`}
          role="alert"
        >
          {FAILURE_TEXT[failure]}
        </div>
      )}
      {/* Desktop only: two of the three keys it names do not exist on a phone. */}
      {isMobile ? null : (
        <div className="answer-pane-hint" data-testid={`answer-pane-hint-${sessionId}`}>
          ENTER SENDS · SHIFT+ENTER NEWLINE · ESC CLOSES THE ANSWER
        </div>
      )}
    </>
  );
}

export default AnswerComposer;
