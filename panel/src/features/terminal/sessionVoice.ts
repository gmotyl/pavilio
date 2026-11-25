import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { CASCADE } from "../speech/engines";
import { isDocSpeechKey } from "../speech/docKey";
import { useOpenaiVoicesSnapshot } from "../speech/useOpenaiVoices";
import { voiceLanguageFor, type VoiceLanguage } from "../speech/voiceLanguage";
import {
  firstCascadeVoice,
  getCascadeOrder,
  getStoredEngine,
  isVoiceAwaitingCatalog,
  projectOfDocVoice,
  voiceFor,
  voiceForDocKey,
  voiceForProject,
} from "../speech/voices";
import { projectOfSession } from "./sessionProject";
import { getSessions } from "./sessionStore";

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
 *
 * `undefined` while the tab cannot place the session — it is not in the
 * session list, which is empty until `/api/terminal/sessions` first answers:
 * an answer that arrives first does not know its project yet, and the host
 * prepares it only provisionally. That is not the same as a session the list
 * does hold whose project has no voice of its own (or which carries no
 * project): that one is placed, and speaks the default voice's language. A
 * page's `doc:` key is always placed, through its path.
 *
 * `undefined` too while the voice that decides is a saved OmniVoice id and
 * the live list that names its locale has not loaded (see
 * {@link isVoiceAwaitingCatalog}): the answer is prepared provisionally, and
 * the list landing is a new port (`TerminalSpeechHost`). A voice that is
 * simply absent — none saved, no enabled member with one — is English as
 * before, and so is an id the loaded list still lacks: it is stale. A
 * page's key is exempt: it still always answers.
 */
export function languageForSession(sessionId: string): VoiceLanguage | undefined {
  if (!isDocSpeechKey(sessionId) && !getSessions().some((session) => session.id === sessionId)) {
    return undefined;
  }
  const project = projectOfSpeechKey(sessionId);
  const engine = getStoredEngine();
  // A page keeps its own rule — it always has an answer, and re-prepares on
  // the next Play once its language moves — so only a cell waits for a catalog.
  const awaiting = (member: string): boolean =>
    !isDocSpeechKey(sessionId) && isVoiceAwaitingCatalog(member, project);
  if (engine === CASCADE) {
    // The member that would decide, if its saved voice could be looked up,
    // comes before the one `firstCascadeVoice` finds: that one is not first.
    for (const entry of getCascadeOrder()) {
      if (!entry.on) continue;
      if (awaiting(entry.id)) return undefined;
      if (voiceFor(entry.id, project) !== undefined) break;
    }
    const first = firstCascadeVoice(project);
    return first ? voiceLanguageFor(first.engine, first.voice) : "en";
  }
  if (awaiting(engine)) return undefined;
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
