/**
 * The answer pane's body while a reply is pending.
 *
 * It replaces the text and the rail rather than sitting over them, because what
 * it is there to prevent is the previous answer being read as the reply — and a
 * translucent layer over the old answer is exactly that with extra steps.
 *
 * `role="status"` and a real sentence: the state has to be legible to a screen
 * reader without the decoration, which is what keeps Task 11's wave free to be
 * purely decorative (`aria-hidden`) when it lands here.
 */
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
      <span className="answer-pane-waiting-label">Waiting for a reply…</span>
    </div>
  );
}

export default AnswerWaiting;
