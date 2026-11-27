import { listVoices, type VoiceInfo } from "anytts";
import { currentPocketWorkspaceVoices } from "./usePocketVoices";
import { currentOpenaiVoices } from "./useOpenaiVoices";

/**
 * The voices an engine offers. For `openai` that is the OmniVoice server's live list: a caller
 * that renders passes the `useOpenaiVoices()` list (so it re-renders when the list changes), and
 * the settings boundary reads the last loaded one. `pocket` and `pocket-pl` are anytts's presets
 * plus the workspace voices the panel server lists (a failed list leaves the presets). Every other
 * engine lists anytts's catalog.
 */
export function voicesOf(
  engine: string,
  openaiVoices: readonly VoiceInfo[] = currentOpenaiVoices(),
): readonly VoiceInfo[] {
  if (engine === "openai") return openaiVoices;
  if (engine === "pocket" || engine === "pocket-pl") {
    const workspace = currentPocketWorkspaceVoices(engine);
    return workspace.length === 0 ? listVoices(engine) : [...listVoices(engine), ...workspace];
  }
  return listVoices(engine);
}
