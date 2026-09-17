import type { ReactNode } from "react";
import { Volume2 } from "lucide-react";
import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { TerminalActivityLed } from "./TerminalActivityLed";

type Props = {
  size?: "sm" | "lg";
  title?: string;
  hideWhenIdle?: boolean;
  /**
   * What the row shows while nothing is speaking. Defaults to the activity LED,
   * which is right for a session row; a project row passes its own aggregate
   * indicator, because `ProjectActivityLed` shows busy AND attention at once
   * and the collapsed row must not lose that just because it gained a speaker.
   */
  fallback?: ReactNode;
} & ({ sessionId: string } | { sessionIds: readonly string[] });

/**
 * The sidebar's one indicator per row: a static speaker while the session is
 * being spoken, the activity LED the rest of the time.
 *
 * Speaking outranks every activity state because the sidebar is the one place a
 * listener looks to find WHICH of several projects is talking, and the voice is
 * the most specific thing the row can say: "busy" is true of half the tree,
 * while "this is the one you are hearing" is true of exactly one row.
 *
 * It does NOT pulse. The pulse in this panel means "something is waiting for
 * you" — the attention LED, the ready speak control — and audio that is already
 * playing is not waiting for anything. A pulsing speaker would spend the
 * panel's one urgency signal on the one thing that needs no action.
 *
 * The host is read through {@link usePanelSpeech}, which throws without a
 * provider above it; there is deliberately no fallback, so a row can never
 * quietly report "nothing is speaking" because it was mounted in the wrong
 * place.
 */
export function SessionIndicator(props: Props) {
  const { size = "sm", title, fallback } = props;
  const { stateFor } = usePanelSpeech();
  const ids: readonly string[] =
    "sessionId" in props ? [props.sessionId] : props.sessionIds;
  // For the aggregate form the first speaking id names the icon: the row stands
  // for the whole project, and only one cell can make sound at a time anyway.
  const speakingId = ids.find((id) => stateFor(id) === "speaking");

  if (speakingId === undefined) {
    return fallback !== undefined ? (
      <>{fallback}</>
    ) : (
      <TerminalActivityLed {...props} />
    );
  }

  return (
    <span
      className={`session-speaker ${size === "lg" ? "session-speaker-lg" : ""}`}
      data-testid={`session-speaker-${speakingId}`}
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

export default SessionIndicator;
