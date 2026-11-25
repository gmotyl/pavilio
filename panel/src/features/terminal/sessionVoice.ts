import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { CASCADE } from "../speech/engines";
import { isDocSpeechKey } from "../speech/docKey";
import { useOpenaiVoicesSnapshot } from "../speech/useOpenaiVoices";
import { voiceLanguageFor, type VoiceLanguage } from "../speech/voiceLanguage";
import {
  firstCascadeVoice,
  getStoredEngine,
  projectOfDocVoice,
  voiceForDocKey,
  voiceForProject,
} from "../speech/voices";
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
 * The project a speech key speaks for, by the same rules as
 * {@link voiceForSession}: a `doc:` key through {@link projectOfDocVoice}, a
 * session through the tab's placement; `undefined` (the default voice) when
 * neither places it.
 */
function projectOfSpeechKey(sessionId: string): string | undefined {
  if (isDocSpeechKey(sessionId)) return projectOfDocVoice(sessionId);
  return projectOfSession(sessionId) ?? undefined;
}

/**
 * The language a cell's text is prepared in: the language of the voice that
 * speaks it, through the same project as {@link voiceForSession}. Under the
 * cascade that is the first enabled member with a voice for the project — the
 * member the cascade tries first. Whether the server can use that member is
 * not known here: a member it skips (no key, no address) hands the text to a
 * later one, which reads it prepared in the first member's language, as any
 * fallback does. Read-only, like {@link voiceForSession}.
 */
export function languageForSession(sessionId: string): VoiceLanguage {
  const project = projectOfSpeechKey(sessionId);
  const engine = getStoredEngine();
  if (engine === CASCADE) {
    const first = firstCascadeVoice(project);
    return first ? voiceLanguageFor(first.engine, first.voice) : "en";
  }
  return voiceLanguageFor(engine, voiceForProject(project));
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
