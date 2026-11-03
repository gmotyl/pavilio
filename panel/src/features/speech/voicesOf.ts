import { listVoices, type VoiceInfo } from "anytts";
import { currentOpenaiVoices } from "./useOpenaiVoices";

/**
 * The voices an engine offers. For `openai` that is the OmniVoice server's live list: a caller
 * that renders passes the `useOpenaiVoices()` list (so it re-renders when the list changes), and
 * the settings boundary reads the last loaded one. Every other engine lists anytts's catalog.
 */
export function voicesOf(
  engine: string,
  openaiVoices: readonly VoiceInfo[] = currentOpenaiVoices(),
): readonly VoiceInfo[] {
  return engine === "openai" ? openaiVoices : listVoices(engine);
}
