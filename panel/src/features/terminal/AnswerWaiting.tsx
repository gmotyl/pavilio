/**
 * The answer pane's body while a reply is pending.
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
 */

/**
 * How many crests the row draws. `index.css` declares a height for each one by
 * `:nth-child`, so this number and that run of rules are the same fact written
 * twice — `AnswerPane.waiting.test.tsx` reads both and refuses to let them
 * disagree.
 */
const CRESTS = 5;

export interface AnswerWaitingProps {
  sessionId: string;
}

export function AnswerWaiting({ sessionId }: AnswerWaitingProps) {
  return (
    <div
      className="answer-pane-waiting"
      data-testid={`answer-pane-waiting-${sessionId}`}
      role="status"
    >
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
      <span className="answer-pane-waiting-label">Waiting for a reply…</span>
    </div>
  );
}
