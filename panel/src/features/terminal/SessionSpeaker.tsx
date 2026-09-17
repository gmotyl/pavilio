import { Volume2 } from "lucide-react";

/**
 * The speaker glyph itself, in the LED's box.
 *
 * It lives in its own module because two unrelated rows draw it: the session
 * row, via {@link SessionIndicator}, where it replaces that session's LED, and
 * the project row's aggregate group, via `ProjectActivityLed`, where it sits
 * alongside the other status dots. Owning it here is what keeps the aggregate
 * from importing the single-slot indicator (and `TerminalActivityLed` behind
 * it) just to borrow a glyph. One definition also keeps both spellings — class,
 * box, title, label — identical, which is what stops a row's text from moving
 * when the indicator changes.
 *
 * It reads no context on purpose: both callers have already resolved WHICH
 * session is speaking, so this takes an id and draws.
 *
 * It does NOT pulse. The pulse in this panel means "something is waiting for
 * you" — the attention LED, the ready speak control — and audio that is already
 * playing is not waiting for anything. A pulsing speaker would spend the
 * panel's one urgency signal on the one thing that needs no action.
 */
export function SessionSpeaker({
  sessionId,
  size = "sm",
  title,
}: {
  sessionId: string;
  size?: "sm" | "lg";
  title?: string;
}) {
  return (
    <span
      className={`session-speaker ${size === "lg" ? "session-speaker-lg" : ""}`}
      data-testid={`session-speaker-${sessionId}`}
      title={title ?? "Speaking"}
      aria-label="Speaking"
    >
      {/* The glyph is drawn larger than its box and centred on it — see
          index.css. The box is what the row's layout is made of; the icon only
          has to be legible. */}
      <Volume2 size={size === "lg" ? 12 : 10} aria-hidden />
    </span>
  );
}

export default SessionSpeaker;
