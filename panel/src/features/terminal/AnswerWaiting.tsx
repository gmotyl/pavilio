/**
 * The answer pane's body while the cell is waiting for its agent — and, when
 * the user has stepped back to re-read, the same wave moved out of the body
 * onto a control.
 *
 * It replaces the text and the rail rather than sitting over them, because what
 * it is there to prevent is the previous answer being read as the reply — and a
 * translucent layer over the old answer is exactly that with extra steps.
 *
 * `role="status"` and a real sentence: the state has to be legible to a screen
 * reader without the decoration, which is what lets the wave be purely
 * decorative — `aria-hidden` on its outermost node, no role, no name, no text.
 *
 * ## Why crests rather than a spinner
 *
 * The wave is the scrubber's segments in another shape: same count-per-unit
 * idea, same `--speech-seg`, while there is nothing yet to draw a rail for. A
 * spinner would have been a second visual language for "the speech surface is
 * busy" on the one surface that already has one. The crests' heights and their
 * stagger live in `index.css` — the shape is a stylesheet fact, so it survives
 * `prefers-reduced-motion` turning the movement off.
 *
 * ## Why the wave moves rather than disappearing
 *
 * Stepping back through the transport holds the answer on screen for as long as
 * the user wants it, and the agent may well still be working. If the wave
 * simply went away there, the pane would stop reporting the one thing it is for
 * — so it shrinks to {@link AnswerWaitingNext} instead: the same crests, still
 * animated, on a button that gives the body back. The fact is never hidden,
 * only made smaller and given a way out.
 */

/**
 * How many crests the row draws. `index.css` declares a height for each one by
 * `:nth-child`, so this number and that run of rules are the same fact written
 * twice — `AnswerPane.waiting.test.tsx` reads both and refuses to let them
 * disagree.
 */
const CRESTS = 5;

/**
 * The ornament, and the whole of the ornament: the halo, the row and the
 * crests, under one `aria-hidden`. Shared by the two surfaces below, so the
 * wave on the control is the wave the body draws rather than a second copy of
 * it that can drift.
 */
function Wave({ sessionId }: { sessionId: string }) {
  return (
    <div
      className="answer-pane-halo"
      data-testid={`answer-pane-wave-${sessionId}`}
      aria-hidden="true"
    >
      <div className="answer-pane-wave">
        {Array.from({ length: CRESTS }, (_, crest) => (
          <span className="answer-pane-wave-crest" key={crest} />
        ))}
      </div>
    </div>
  );
}

export interface AnswerWaitingProps {
  sessionId: string;
  /**
   * How many of the answers the queue can still reach have never been played.
   * Zero shows nothing: a pip reading "0" says there is a backlog and then says
   * the backlog is empty.
   */
  unread: number;
}

export function AnswerWaiting({ sessionId, unread }: AnswerWaitingProps) {
  return (
    <div
      className="answer-pane-waiting"
      data-testid={`answer-pane-waiting-${sessionId}`}
      role="status"
    >
      <Wave sessionId={sessionId} />
      {/*
        It names the AGENT, not a reply. The state has three triggers — a
        composer send, a launcher press, and the session going busy on its own
        — and only the first of them is a reply to anybody: an agent that went
        to work by itself is answering no one, and pressing `start` asked no
        question. "Waiting for a reply" was honest for one trigger in three.
      */}
      <span className="answer-pane-waiting-label">Waiting for agent</span>
      {/*
        In TEXT, inside the status region — never as a number painted onto the
        ornament. The wave is `aria-hidden`, so a count drawn there would exist
        for sighted readers alone; here it is read out with the state's own
        name, which is what makes a backlog something a screen reader user can
        act on rather than something they are never told about.
      */}
      {unread > 0 ? (
        <span
          className="answer-pane-waiting-count"
          data-testid={`answer-pane-waiting-count-${sessionId}`}
        >
          {unread} {unread === 1 ? "answer" : "answers"} not played
        </span>
      ) : null}
    </div>
  );
}

export interface AnswerWaitingNextProps {
  sessionId: string;
  /** Release the hold: the body goes back to the agent, and the wave with it. */
  onActivate: () => void;
}

/**
 * The wave with the body taken away from it: a button carrying the same
 * animation, rendered beside the answer the user is holding on screen.
 *
 * A real button with a real name, unlike the ornament it contains. The
 * scrubber's segments are `aria-hidden` because they duplicate a function the
 * transport already exposes; this one exposes a function nothing else does from
 * here — the way out of a hold, on the surface the hold is visible on — so it
 * takes a tab stop and announces itself like any other control.
 */
export function AnswerWaitingNext({ sessionId, onActivate }: AnswerWaitingNextProps) {
  return (
    <button
      type="button"
      className="answer-pane-waiting-next"
      data-testid={`answer-pane-waiting-next-${sessionId}`}
      title="Next answer"
      aria-label="Next answer"
      onClick={onActivate}
    >
      <Wave sessionId={sessionId} />
    </button>
  );
}
