import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { isDocSpeechKey } from "../speech/docKey";
import { useOpenaiVoicesSnapshot } from "../speech/useOpenaiVoices";
import { voiceForDocKey, voiceForProject } from "../speech/voices";
import { projectOfSession } from "./sessionProject";

/**
 * The voice a cell speaks with, through the project its session belongs to;
 * a session the tab cannot place gets the default voice. A page's `doc:` key
 * speaks with the voice of the project its path lives in, and a file outside
 * projects with the default.
 *
 * Read-only, like {@link voiceForProject}: the answer pane and the control bar
 * call it during render. It lives with the terminal because placing a session
 * in its project is a terminal fact; speech receives it as the host's
 * `voiceFor` port.
 */
export function voiceForSession(sessionId: string): string {
  if (isDocSpeechKey(sessionId)) return voiceForDocKey(sessionId);
  return voiceForProject(projectOfSession(sessionId) ?? undefined);
}

/**
 * {@link voiceForSession} for a render path: the answer pane and the control
 * bar. It subscribes to everything the answer depends on — the engine, both
 * voice preferences, and the live OmniVoice list, which lands after a page
 * reload and turns a saved openai voice from "unknown" into the one in effect.
 * The values are discarded: subscribing IS the point.
 */
export function useVoiceForSession(sessionId: string): string {
  usePreference(preferences.speechEngine);
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  useOpenaiVoicesSnapshot();
  return voiceForSession(sessionId);
}
