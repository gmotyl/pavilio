import type { OmniVoiceInfo } from "../openaiVoices";

/**
 * A live OmniVoice catalog as `GET /api/speech/openai/voices` answers it: the custom default, a
 * multilingual bundled voice, and one single-language voice per language.
 */
export const MY_VOICE: OmniVoiceInfo = {
  id: "my-voice",
  label: "My voice",
  locale: "pl-PL",
  gender: "male",
  multilingual: true,
  source: "custom",
};
export const PL_FEMALE: OmniVoiceInfo = {
  id: "pl-female",
  label: "Polish female",
  locale: "pl-PL",
  gender: "female",
  multilingual: false,
  source: "bundled",
};
export const EN_MALE: OmniVoiceInfo = {
  id: "en-male",
  label: "English male",
  locale: "en-GB",
  gender: "male",
  multilingual: false,
  source: "bundled",
};

export const LIVE_VOICES: readonly OmniVoiceInfo[] = [MY_VOICE, PL_FEMALE, EN_MALE];

/** The route's 200 body for `voices`. */
export function voicesBody(voices: readonly OmniVoiceInfo[] = LIVE_VOICES, workspaceOnly = 0) {
  return { voices, unreachable: false, workspaceOnly };
}

/** The `stubFetch` route fragment for the voice listing. */
export const OPENAI_VOICES_URL = "/api/speech/openai/voices";
