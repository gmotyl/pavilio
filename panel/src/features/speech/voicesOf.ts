import { listVoices, type VoiceInfo } from "anytts";
import { OPENAI_CATALOG } from "./openaiVoices";

/** The voices an engine offers: the panel's OmniVoice catalog for `openai`, anytts's list otherwise. */
export function voicesOf(engine: string): readonly VoiceInfo[] {
  return engine === "openai" ? OPENAI_CATALOG : listVoices(engine);
}
