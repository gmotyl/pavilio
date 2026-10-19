/**
 * The engines the panel's anytts instance configures: the ONE engine list.
 *
 * `synth.ts` builds its instance from {@link SPEECH_ENGINES}; the settings
 * boundary (`voices.ts`) and the Engine picker go by {@link speechEngines}.
 * anytts may list more engines than this — any of those reaching
 * `resolveVoice` or `synthesize` would throw RangeError, so they are as
 * unknown here as a typo.
 *
 * A module of its own, below the seam, so the many suites that mock
 * `synth.ts` wholesale still get the real list.
 */
import type { TtsConfig } from "anytts";
import { DEFAULT_SPEECH_VOICE } from "../../preferences/declarations";

/** Max gap between audio chunks before anytts treats the stream as stalled and retries. */
export const SPEECH_STREAM_STALL_TIMEOUT_MS = 15000;

/**
 * Max wait for the first audio byte before anytts gives up and retries.
 *
 * Sized for the relay, not the socket: anytts' relay answers only after the
 * server has synthesized the WHOLE clip, so in relay mode this wait covers the
 * server's own first-byte wait (8s) plus the synthesis. At anytts' 8s default
 * a slow Edge turn (12.7s measured on a short sentence) failed in the browser
 * while the server went on to succeed. Also applies to the direct socket,
 * where it only makes a dead turn take longer to be declared dead.
 */
export const SPEECH_FIRST_BYTE_TIMEOUT_MS = 25000;

export const SPEECH_ENGINES: TtsConfig["engines"] = {
  edge: {
    voices: { default: DEFAULT_SPEECH_VOICE },
    // The panel server mounts anytts' relay here for browsers that cannot
    // open the Edge socket themselves.
    relayUrl: "/api/tts",
    firstByteMs: SPEECH_FIRST_BYTE_TIMEOUT_MS,
    stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
  },
};

/** The configured engine ids. */
export function speechEngines(): string[] {
  return Object.keys(SPEECH_ENGINES);
}
