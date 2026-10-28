import { TtsError, type TtsErrorKind } from "anytts";

import type { SpeechPlaybackError } from "./useSpeechPlayer";

const NOT_RESPONDING = "Speech stopped — the speech service is not responding.";

/** One line per anytts failure kind; the transient three read alike to a listener. */
const ALERT_BY_KIND: Record<TtsErrorKind, string> = {
  rejected: "Speech stopped — the speech service refused the request.",
  "first-byte-timeout": NOT_RESPONDING,
  stalled: NOT_RESPONDING,
  network: NOT_RESPONDING,
  "no-audio": "Speech stopped — the service returned no audio for this text.",
  "unknown-voice": "Speech stopped — the chosen voice is unavailable, pick another in Settings.",
  "quota-exhausted": "Speech stopped — the speech service quota is used up.",
  unauthorized: "Speech stopped — the speech service rejected the API key.",
  "rate-limited": "Speech stopped — the speech service is limiting requests, try again shortly.",
};

const GENERIC_ALERT = "Speech stopped — the voice could not be synthesized.";

/**
 * The kind of a TtsError cause, or null. `instanceof` first; the name + kind
 * shape covers a TtsError from a second bundled copy of anytts, which fails
 * `instanceof` against this module's class. A kind this panel has no line
 * for counts as unknown, so a newer library never yields an empty alert.
 */
function ttsErrorKind(cause: unknown): TtsErrorKind | null {
  const shaped =
    cause instanceof TtsError ||
    (cause instanceof Error && cause.name === "TtsError" && "kind" in cause);
  if (!shaped) return null;
  const kind = (cause as { kind: unknown }).kind;
  return typeof kind === "string" && Object.hasOwn(ALERT_BY_KIND, kind)
    ? (kind as TtsErrorKind)
    : null;
}

/** The speech-stopped alert, worded by why synthesis failed when anytts said. */
export function speechFailureAlert(error: SpeechPlaybackError): string {
  const kind = ttsErrorKind(error.cause);
  return kind ? ALERT_BY_KIND[kind] : GENERIC_ALERT;
}
