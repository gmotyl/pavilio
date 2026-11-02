/**
 * The OmniVoice catalog for anytts's `openai` engine — the single place to edit the voice list.
 * Voice ids are the omnivoice-server voice file names. Type-only imports from anytts, so the
 * server can import this module too.
 */
import type { EngineConfig, VoiceInfo } from "anytts";

// anytts does not export `VoiceMap` from its entry point; derive it from the engine config.
type VoiceMap = NonNullable<EngineConfig["voices"]>;

export const OPENAI_CATALOG: VoiceInfo[] = [
  { id: "cand-en-gb-f2", locale: "en-GB", gender: "female", label: "British, middle-aged, low", multilingual: false },
  { id: "cand-en-gb-f3", locale: "en-GB", gender: "female", label: "British, young, high", multilingual: false },
  { id: "cand-en-gb-m1", locale: "en-GB", gender: "male", label: "British, young", multilingual: false },
  { id: "cand-en-gb-m2", locale: "en-GB", gender: "male", label: "British, middle-aged, low", multilingual: false },
  { id: "cand-en-gb-m3", locale: "en-GB", gender: "male", label: "British, elderly, low", multilingual: false },
  { id: "en-female", locale: "en-GB", gender: "female", label: "English, young (spike)", multilingual: false },
  { id: "en-male", locale: "en-US", gender: "male", label: "American, middle-aged, low (spike)", multilingual: false },
  { id: "cand-pl-f2", locale: "pl-PL", gender: "female", label: "Polish, middle-aged, low", multilingual: false },
  { id: "pl-female", locale: "pl-PL", gender: "female", label: "Polish, young (spike)", multilingual: false },
  { id: "cand-pl-m1", locale: "pl-PL", gender: "male", label: "Polish, young", multilingual: false },
  { id: "cand-pl-m2", locale: "pl-PL", gender: "male", label: "Polish, middle-aged, very low", multilingual: false },
  { id: "cand-pl-m3", locale: "pl-PL", gender: "male", label: "Polish, elderly, low", multilingual: false },
  { id: "cand-pl-m4", locale: "pl-PL", gender: "male", label: "Polish, young, low", multilingual: false },
  { id: "pl-male", locale: "pl-PL", gender: "male", label: "Polish, middle-aged, low (spike)", multilingual: false },
];

export const OPENAI_VOICE_MAP: VoiceMap = { pl: "cand-pl-f2", en: "cand-en-gb-f2", default: "cand-pl-f2" };
