import { useLayoutEffect, useRef, useState } from "react";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { preferences } from "../../preferences/declarations";
import { toast } from "../../lib/toast";
import { clearDraft, getDraft, setDraft } from "./composerDrafts";
import { imageFromClipboardItems, uploadPastedImage } from "./imagePaste";
import { submitToPty, type SubmitFailure } from "./ptySubmit";
import { projectOfSession } from "./sessionProject";
import { reconnectOnActivate } from "./terminalInstances";
import { dismissAttentionOnArrival } from "./attentionArrival";

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
 * The mobile field's height floor and ceiling, in ROWS rather than pixels.
 *
 * There is no drag on a touch viewport — `isMobile` below renders no grip at
 * all — so the field has no stored height to clamp between; what it has
 * instead is a reply that keeps growing while it is typed. The floor is what
 * `rows={MOBILE_COMPOSER_MIN_ROWS}` already draws before a single character
 * has grown into it, so the field never reads as shrinking past its own
 * starting size. The ceiling is short of the pane for the same reason the
 * desktop bound is short of the answer above it: a reply tall enough to fill
 * the screen has stopped being a REPLY, and six rows is where this pane draws
 * that line — past it the field scrolls internally instead of pushing the
 * send button off screen.
 */
const MOBILE_COMPOSER_MIN_ROWS = 2;
const MOBILE_COMPOSER_MAX_ROWS = 6;

/**
 * The line height the cap falls back to when `getComputedStyle` cannot report
 * one in pixels.
 *
 * `index.css` writes `.answer-pane-composer-field { line-height: 1.5; }` —
 * unitless, which is the CSS author's way of saying "1.5 times whatever the
 * font size is" rather than a fixed box. A real browser resolves that to a
 * pixel `getComputedStyle` value; a host with no stylesheet loaded — jsdom in
 * a test, most of all — reports `"normal"` or hands back the bare `"1.5"`
 * with no unit, and either one is the wrong number of pixels to multiply six
 * rows by. This is a plain guess at the field's actual line box (12px type at
 * 1.5) rather than a derivation, so the cap stays a sane height instead of
 * caching a `NaN`.
 */
const FALLBACK_LINE_HEIGHT_PX = 20;

/**
 * What the pane says when the socket refused one half of a submit.
 *
 * Two sentences, because the two failures leave the reply in two different
 * places and the user's next move differs. A refused BODY never left the
 * browser, so the text is still in the field and the whole of the news is that
 * it did not go. A refused RETURN left the body in the TUI's prompt with
 * nobody having pressed Enter on it — the field is legitimately empty, and
 * saying "not sent" there would be a lie that sent the user looking for text
 * that is sitting in the terminal underneath.
 */
const FAILURE_TEXT: Record<SubmitFailure, string> = {
  body: "Not sent — the terminal is not connected. Your reply is still here.",
  return: "Sent but not submitted — the terminal disconnected. The line is in the prompt below.",
};

/**
 * What the pane says while a submit is still in flight.
 *
 * A verdict is no longer always immediate. A refused body now rebuilds the
 * cell's socket and offers the frame to the replacement, and `ptySubmit`
 * bounds that wait at `RECONNECT_WAIT_MS` — three seconds. For those three
 * seconds the reply sits in a full field with nothing visibly happening, and a
 * full field after Enter is precisely what a SWALLOWED keystroke looks like:
 * the user's obvious next move is to press Enter again, which is the double
 * send this would rather not invite.
 *
 * So the wait is named, and it takes the same row the verdict will. That row
 * is the same fact at an earlier moment — this submit's standing — and a
 * second surface saying "sending" one line above where "not sent" appears
 * would be two places to look for one answer.
 */
const PENDING_TEXT = "Sending… waiting for the terminal.";

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
   * A draft has just gone out. Raised at the moment the body is written, and
   * only then — the pane hands its body over to the waiting state here,
   * because it is the pane that knows which answer the draft was a reply to.
   *
   * Not raised at all for a submit the socket refused, and raised late rather
   * than early for one that had to queue behind another: a submit is written
   * when its turn comes, and the wait is about the write.
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
 * Nothing is retried LATER. `reconnectOnActivate` already repairs a dead
 * socket the moment the user goes near the cell (ADR 0010), so the resend
 * costs a second keypress — whereas a reply flushed on some future reconnect
 * would arrive at whatever the agent had moved on to, answering a prompt that
 * is no longer on screen. What `ptySubmit` does offer is narrower: the socket
 * is rebuilt and the same frame offered to it once, inside this gesture.
 *
 * ## Why the draft is consumed by DELIVERY and not by pressing Enter
 *
 * That retry is why. The field used to be emptied before the submit and
 * refilled from `onFailed`, which was fair while a refusal was reported
 * synchronously — the clear and the restore happened in the same frame and
 * neither was ever seen. The reconnect made that callback up to three seconds
 * late, and the shortcut became two bugs at once.
 *
 * For those three seconds the user had an empty box, no failure notice and no
 * sign a send was in flight: the pane had thrown their reply away and said
 * nothing, which is the exact outcome this whole file exists to prevent. And
 * anyone who used the wait to type a NEW reply had it overwritten when the
 * late restore ran — the composer destroying text the user could see.
 *
 * So the draft is kept until the frame is DELIVERED, which is what the design
 * said all along: `onDelivered` is where the clear belongs, because it is the
 * first moment the reply exists anywhere but here. On a live socket that
 * callback runs inside the same event handler the Enter did, so nothing about
 * the ordinary send feels any slower; only the reconnect path lags, and
 * lagging is the truth there.
 *
 * The clear is CONDITIONAL, for the case above: it happens only if the field
 * still holds exactly the text that was submitted. A user who typed on during
 * the wait has a reply of their own in there, and a delivery three seconds
 * later has no claim on it — the frame that went was the old text, so the new
 * text is an unsent draft like any other. Compared with the alternatives —
 * clearing unconditionally (destroys it), or locking the field for the
 * duration (takes the box away for three seconds over a send that usually
 * succeeds) — leaving a moved-on field alone is the only option that never
 * loses a character.
 *
 * A refused RETURN still clears, because the body reached the prompt: the
 * clear happened at delivery, one turn earlier, and putting the text back now
 * would give the user two copies of one reply.
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
 * the pane), no hint, no STORED height at all — instead the field grows itself
 * from `scrollHeight`, up to six rows, and the mechanism for that is the
 * `useLayoutEffect` above this component.
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
  /**
   * How many submits made from this field are still unsettled.
   *
   * A COUNT and not a boolean, and the boolean it replaces carried a comment
   * saying "at most one submit can be unsettled here at a time" that was
   * simply untrue. {@link submit} has no guard: a second Enter on a socket
   * that is flapping enqueues a second submit inside `ptySubmit`'s per-session
   * queue, and the two are then unsettled together. With a boolean, the FIRST
   * one to settle cleared it — so the second spent its whole three-second
   * reconnect wait with no row at all, which is an empty box and a send that
   * visibly did nothing: the exact symptom this row was added to remove.
   *
   * Nothing else needed to change with it. Each submit raises exactly one of
   * `onDelivered`/`onFailed` ({@link SubmitReport}), so every increment has
   * exactly one decrement, and a refused RETURN — the one case that raises
   * both — is raised for a submit whose delivery already decremented.
   *
   * {@link failure} stays a single value rather than a history for its own
   * reason: what the user needs is the standing of the reply in front of them,
   * not a log. A count is not a history; it is how many answers are still
   * owed.
   *
   * On a live socket this is raised and lowered inside one event handler, so
   * it is batched away and the user never sees it. It becomes visible exactly
   * where it is needed: a submit queued behind another, and the three-second
   * reconnect wait.
   */
  const [unsettled, setUnsettled] = useState(0);
  const pending = unsettled > 0;
  /** The mobile auto-grow effect's own handle on the field — see below. */
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const { height, isMobile, handleProps } = useResizableRow(
    preferences.answerComposerHeight,
    BOUNDS,
    // The scope: a cell's reply box is as tall as the project's work wants it,
    // and a session id would be forgotten the next time the agent restarted.
    projectOfSession(sessionId),
  );

  /**
   * The mobile field grows with the reply instead of the pane scrolling to
   * keep it in view.
   *
   * Desktop's height is the grip's (`handleProps` / `PaneResizer` above), and
   * this effect leaves it alone entirely — on `isMobile === false` it returns
   * before reading or writing anything, so `style.height` is never touched by
   * it and the field goes on filling the row the desktop layout gives it.
   *
   * On mobile there is no grip to ask, so the field measures itself.
   * `"auto"` first, because `scrollHeight` on a field already sized to its
   * own last measurement reports THAT height back, never a smaller one — a
   * shrinking reply (an edit, or the clear on send) would otherwise only
   * ever grow. Collapsing first is what lets the field shrink as well as
   * grow, and it is why sending returns the field to its minimum with no
   * special case for it: the text clears, this effect reruns on the
   * now-empty value, and an empty field's natural `scrollHeight` is
   * `MOBILE_COMPOSER_MIN_ROWS` worth — the same floor `rows` already draws
   * it at before a single character has grown into it.
   *
   * `useLayoutEffect` rather than `useEffect`: the measurement has to run
   * against the DOM the keystroke that changed `text` just committed, and
   * before the browser paints — a plain effect would let a grown line flash
   * at the OLD height for a frame first.
   */
  useLayoutEffect(() => {
    if (!isMobile) return;
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    const parsedLineHeight = Number.parseFloat(getComputedStyle(field).lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : FALLBACK_LINE_HEIGHT_PX;
    field.style.height = `${Math.min(field.scrollHeight, MOBILE_COMPOSER_MAX_ROWS * lineHeight)}px`;
  }, [text, isMobile]);

  /**
   * The draft this submit was made of is on the far side now, so spend it —
   * unless the field has moved on.
   *
   * The guard is the edit-during-wait case. A delivery can be up to three
   * seconds after the Enter that asked for it (the reconnect retry), and the
   * field stayed live and editable across that wait on purpose. If what is in
   * it now is no longer what went, it is a reply of the user's own that no
   * frame has been written for, and emptying it would be the composer
   * destroying text the user is looking at.
   *
   * The store is what "now" is read from rather than a `setText` updater's
   * `prev`: every keystroke writes it, so it holds the same characters the
   * field does, and an updater that read state to decide a side effect would
   * be doing it inside a function React double-invokes under StrictMode.
   */
  const consumeDraft = (submitted: string): void => {
    if (getDraft(sessionId) !== submitted) return;
    // The one thing that consumes a draft. Nothing else in this file — or in
    // the pane above it — calls `clearDraft`.
    clearDraft(sessionId);
    setText("");
    setPasted([]);
  };

  /** The one way out of this field, whichever control asked for it. */
  const submit = (): void => {
    if (text.trim() === "") return;
    // The reply this submit is made of, captured because the field it came
    // from goes on being editable while the submit is in flight — this string
    // is what was actually written, and what the clear below is conditional on.
    const reply = text;
    // The last submit's verdict is spent the moment a new one is made, and
    // this one has no verdict yet.
    setFailure(null);
    // One more answer owed. Raised with an updater rather than from `pending`,
    // because a settle that lands between this render and this call would
    // otherwise be written back out of existence.
    setUnsettled((n) => n + 1);
    // Nothing is cleared here. The draft is spent by DELIVERY, in the callback
    // below — see the note on this component: a clear made on the strength of
    // an Enter is a clear made before anything is known, and the verdict can
    // now be three seconds away.
    //
    // The body now, its submitting return on a later turn — never one write.
    submitToPty(sessionId, send, reply, {
      // The waiting state means "the agent is working on what I just said", so
      // the pane is handed over where the body is actually WRITTEN and nowhere
      // else. This used to be decided here, from a flag the failure callback
      // cleared, on the reasoning that a refusal is reported synchronously —
      // and that is true only of a submit `submitToPty` writes inline. A
      // submit made while this session already has one in flight is enqueued
      // and written a gap later, so the flag was still saying "delivered" when
      // it was read, and a reply the socket went on to refuse put the pane
      // into a wait for an answer to something the agent had never been told.
      onDelivered: () => {
        setUnsettled((n) => n - 1);
        // The frame is on the socket, which is the first moment this reply
        // exists anywhere but in this browser — so this is the moment it stops
        // being a draft.
        consumeDraft(reply);
        onSubmitted();
      },
      onFailed: (stage) => {
        // A refused RETURN comes after a delivery that already lowered this,
        // which is why the decrement is here rather than shared: each submit
        // raises exactly one of these two callbacks, and the return's refusal
        // is raised on the same report object as its own body's delivery was.
        if (stage === "body") setUnsettled((n) => n - 1);
        setFailure(stage);
        // Nothing to put back on EITHER half now. A refused body never cleared
        // the field in the first place, so the reply is simply still there,
        // still in the store, and still an unsent draft — which is also why a
        // user who typed on during the wait keeps what they typed. A refused
        // return comes after a delivery that already spent the draft, and the
        // text it is about is in the TUI's prompt: restoring it here would
        // give the user two copies of one reply.
      },
    });
    // A refused RETURN is deliberately not undone here either. It arrives
    // after the handover above — the return is written a turn later — and that
    // is fair: the reply IS on the far side, it simply has not been run, so
    // the wait is about something the agent can still be given with one
    // keypress in the terminal, and the notice says exactly that.
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
            ref={fieldRef}
            className="answer-pane-composer-field"
            data-testid={`answer-pane-composer-${sessionId}`}
            aria-label="Reply to this cell"
            placeholder="Reply to the terminal…"
            rows={isMobile ? MOBILE_COMPOSER_MIN_ROWS : 2}
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
            // Arriving at the cell, in the plainest form the panel has: the
            // user is not merely looking at the answer, they are typing a reply
            // to it. The rule itself — why only `attention` is cleared, and why
            // the state is read imperatively rather than subscribed to — is
            // `attentionArrival`, shared with every transport control.
            //
            // `onFocus` rather than the first keystroke: the reply is being
            // written from the moment the caret is here, and a notice the user
            // is demonstrably answering has already served its purpose. Focus
            // repeats freely while a reply is written, which is the case that
            // rule's `attention`-only guard exists for.
            //
            // The same reasoning, one step further, is why the SOCKET is
            // repaired here too. The caret landing in this field is the user
            // saying they are about to send something, and that — not the
            // Enter at the end of it — is the moment to reopen a dead socket:
            // a reconnect started while the reply is still being typed has the
            // whole draft's worth of time to finish, so the send finds a live
            // socket and the refusal path above is never reached. ADR 0010 is
            // what permits it: activation IS the consent, exactly as a click
            // on the disconnected badge is, and `reconnectOnActivate` carries
            // the guards — a healthy session, an exited one and a second focus
            // during the handshake all fall straight back out of it, which is
            // why a focus that repeats per keystroke-pause costs nothing.
            //
            // It is safe here only because this field has NO autofocus: a
            // focus event is always a real user action, so the pane opening
            // itself on an arriving answer never reaches this. Adding
            // `autoFocus` would turn an answer LANDING into a reconnect, which
            // is the "reopened unasked" case the living terminal forbids —
            // `AnswerComposer.focusReconnect.test.tsx` guards that.
            onFocus={() => {
              dismissAttentionOnArrival(sessionId);
              reconnectOnActivate(sessionId);
            }}
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
      {/* This submit's standing: in flight, or refused. In the pane rather
          than in a toast that floats over the corner of the window, because it
          is about the text in the field above it. On every viewport, unlike
          the hint — a phone is exactly where a socket drops, and there is no
          second place there to notice it.

          ONE row for both, in one place: "sending" and "not sent" are the same
          question answered at two moments, and a pending line above a failure
          line would leave the user reading two notices about one Enter. It is
          taken down on either outcome, because both settle it — and while more
          than one submit is unsettled it stays up until the LAST of them
          settles, which is what the count behind `pending` is for.

          The verdict is announced and the wait is not: `role="alert"` is
          assertive and interrupts, which is right for news the user cannot see
          any other way — the colour is all a sighted user gets — and wrong for
          a progress note that will be replaced within three seconds. The wait
          gets `role="status"`, the polite half of the same pair.

          The `key` is what makes that pair take effect. A live region's
          politeness is computed when the region is ATTACHED, so a role swapped
          on a node that stayed in the document is not reliably re-evaluated —
          and one row for two states is exactly such a node: React would reuse
          it, and the assertive verdict would most likely be announced
          politely. A key that changes with the state makes React unmount the
          old region and attach a new one with the role it is meant to have.
          Same position, same class, same testid — one element in the layout,
          two regions over its life. */}
      {failure === null && !pending ? null : (
        <div
          key={failure === null ? "pending" : "failed"}
          className="answer-pane-send-failed"
          data-testid={`answer-pane-send-failed-${sessionId}`}
          data-state={failure === null ? "pending" : "failed"}
          role={failure === null ? "status" : "alert"}
        >
          {failure === null ? PENDING_TEXT : FAILURE_TEXT[failure]}
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
