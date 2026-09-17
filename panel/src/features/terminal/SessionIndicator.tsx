import { Volume2 } from "lucide-react";
import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { TerminalActivityLed } from "./TerminalActivityLed";

type Props = {
  size?: "sm" | "lg";
  title?: string;
  hideWhenIdle?: boolean;
} & ({ sessionId: string } | { sessionIds: readonly string[] });

/**
 * The speaker glyph itself, in the LED's box.
 *
 * It lives apart from {@link SessionIndicator} because two rows draw it: the
 * session row, where it replaces that session's LED, and the project row's
 * aggregate group, where it sits alongside the other status dots. One
 * definition keeps both spellings — class, box, title, label — identical, which
 * is what stops a row's text from moving when the indicator changes.
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

/**
 * A single row's indicator: a static speaker while the session is being spoken,
 * the activity LED the rest of the time.
 *
 * This is the SINGLE-slot form, used where the row has exactly one dot to give:
 * the speaker and the LED share an identical box, so the row's text does not
 * move when one becomes the other. Where a row shows several statuses at once —
 * the collapsed project row — the speaker is one flag among them instead; see
 * `ProjectActivityLed`.
 *
 * Speaking outranks the activity state here because the sidebar is the one
 * place a listener looks to find WHICH of several rows is talking, and the
 * voice is the most specific thing the row can say: "busy" is true of half the
 * tree, while "this is the one you are hearing" is true of exactly one row.
 *
 * The host is read through {@link usePanelSpeech}, which throws without a
 * provider above it; there is deliberately no fallback, so a row can never
 * quietly report "nothing is speaking" because it was mounted in the wrong
 * place.
 */
export function SessionIndicator(props: Props) {
  const { size = "sm", title } = props;
  const { stateFor } = usePanelSpeech();
  const ids: readonly string[] =
    "sessionId" in props ? [props.sessionId] : props.sessionIds;
  // For the aggregate form the first speaking id names the icon: the row stands
  // for the whole project, and only one cell can make sound at a time anyway.
  const speakingId = ids.find((id) => stateFor(id) === "speaking");

  if (speakingId === undefined) return <TerminalActivityLed {...props} />;

  return <SessionSpeaker sessionId={speakingId} size={size} title={title} />;
}

export default SessionIndicator;
