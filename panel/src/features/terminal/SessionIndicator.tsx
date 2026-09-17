import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { SessionSpeaker } from "./SessionSpeaker";
import {
  TerminalActivityLed,
  type ActivityIndicatorProps,
} from "./TerminalActivityLed";

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
 * The props are `ActivityIndicatorProps` — the LED's own type, imported rather
 * than restated — because every prop this takes is forwarded to the LED
 * verbatim. Sharing the type turns a future divergence into a compile error
 * instead of a prop that silently stops arriving.
 *
 * The host is read through {@link usePanelSpeech}, which throws without a
 * provider above it; there is deliberately no fallback, so a row can never
 * quietly report "nothing is speaking" because it was mounted in the wrong
 * place.
 */
export function SessionIndicator(props: ActivityIndicatorProps) {
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
