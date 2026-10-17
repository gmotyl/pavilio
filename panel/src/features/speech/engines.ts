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

export const SPEECH_ENGINES: TtsConfig["engines"] = {
  edge: {
    voices: { default: DEFAULT_SPEECH_VOICE },
    // The panel server mounts anytts' relay here for browsers that cannot
    // open the Edge socket themselves.
    relayUrl: "/api/tts",
    stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
  },
};

/** The configured engine ids. */
export function speechEngines(): string[] {
  return Object.keys(SPEECH_ENGINES);
}
