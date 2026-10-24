import { useSyncExternalStore } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { projectOfDocKey } from "./docKey";
import { SpeechTransport } from "./SpeechTransport";
import { usePanelSpeech } from "./SpeechHostProvider";
import { voiceForProject } from "./voices";

export interface DocumentSpeechBarProps {
  /** The page's speech key, from `docSpeechKey` — `doc:` plus its projects-relative path. */
  docKey: string;
}

/**
 * The document speech bar: the shared transport for one page's key, and
 * nothing else. A page is not a terminal cell — it is never armed, has no queue
 * to step through and no answer pane to open — so the cell bar's mode switch,
 * previous/next, eye button, launchers and hide toggle have no counterpart here.
 *
 * Everything it shows is read from the panel's one host by the key, the same
 * way the cell bar reads a session: the page's run IS an utterance in the
 * host's channel, so play, pause, resume and a segment jump are the host's
 * ordinary actions on that key.
 *
 * The `.speech-bar` / `.speech-bar-row` wrapper is the cell bar's, reused for
 * the flex row the transport's stylesheet expects.
 */
export function DocumentSpeechBar({ docKey }: DocumentSpeechBarProps) {
  const speech = usePanelSpeech();
  const state = speech.stateFor(docKey);
  const units = speech.unitsFor(docKey);
  // External stores, not fields — see the cell bar for why the playhead is.
  const progress = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.progressFor(docKey),
  );
  const durations = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.unitDurationsFor(docKey),
  );

  // The voice the page's units were synthesized in — its project's, else the
  // default — or a cached unit reads as cold: the cache keys on voice + text.
  // Resolved here from the key rather than through the terminal's
  // `voiceForSession`, which speech may not import; both voice preferences are
  // subscribed to only so a change re-reads it.
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  const voice = voiceForProject(projectOfDocKey(docKey) ?? undefined);

  return (
    <div className="speech-bar" data-testid={`document-speech-bar-${docKey}`}>
      <div className="speech-bar-row">
        <SpeechTransport
          id={docKey}
          state={state}
          units={units}
          durations={durations}
          progress={progress}
          voice={voice}
          onPlay={() => speech.onSpeak(docKey)}
          onPause={() => speech.onPause(docKey)}
          onResume={() => speech.onResume(docKey)}
          onJumpToUnit={(index) => speech.onJumpToUnit(docKey, index)}
          onSeekWithinUnit={(seconds) => speech.onSeekWithinUnit(docKey, seconds)}
        />
      </div>
    </div>
  );
}

export default DocumentSpeechBar;
