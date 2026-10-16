import { TtsError, type TtsErrorKind } from "anytts";
import { describe, expect, it } from "vitest";

import { speechFailureAlert } from "../failureAlert";
import { SpeechPlaybackError } from "../useSpeechPlayer";

const failure = (cause: unknown): SpeechPlaybackError =>
  new SpeechPlaybackError("synthesis", "cell-a", "speech produced nothing", cause, 0);

const GENERIC = "Speech stopped — the voice could not be synthesized.";

describe("speechFailureAlert", () => {
  it("maps each TtsError kind to its alert", () => {
    const expected: Record<TtsErrorKind, string> = {
      rejected: "Speech stopped — the speech service refused the request.",
      "first-byte-timeout": "Speech stopped — the speech service is not responding.",
      stalled: "Speech stopped — the speech service is not responding.",
      network: "Speech stopped — the speech service is not responding.",
      "no-audio": "Speech stopped — the service returned no audio for this text.",
      "unknown-voice":
        "Speech stopped — the chosen voice is unavailable, pick another in Settings.",
    };
    for (const [kind, text] of Object.entries(expected) as Array<[TtsErrorKind, string]>) {
      expect(speechFailureAlert(failure(new TtsError(kind))), kind).toBe(text);
    }
  });

  it("recognizes a TtsError from another copy of the library by its shape", () => {
    // A second bundled copy of anytts fails `instanceof`; name + kind still say it.
    const foreign = Object.assign(new Error("refused"), { name: "TtsError", kind: "rejected" });
    expect(speechFailureAlert(failure(foreign))).toBe(
      "Speech stopped — the speech service refused the request.",
    );
  });

  it("falls back to the generic alert for other causes", () => {
    const causes: unknown[] = [
      new Error("synthesis failed"),
      new DOMException("decode", "NotSupportedError"),
      null,
      undefined,
      "boom",
      // A TtsError-shaped value with a kind this panel does not know.
      Object.assign(new Error("x"), { name: "TtsError", kind: "brand-new-kind" }),
    ];
    for (const cause of causes) {
      expect(speechFailureAlert(failure(cause)), String(cause)).toBe(GENERIC);
    }
  });
});
