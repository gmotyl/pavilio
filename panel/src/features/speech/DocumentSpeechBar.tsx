import { useState, useSyncExternalStore } from "react";
import { alerts } from "../alerts/store";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { formatBytes } from "./formatBytes";
import { clearPage, pageCachedShare, subscribePageCache } from "./pageCache";
import { SpeechTransport } from "./SpeechTransport";
import { usePageSpeech, usePanelSpeech } from "./SpeechHostProvider";
import { voiceForDocKey } from "./voices";

const LABEL_STYLE = {
  fontSize: 12,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
} as const;

const CLEAR_STYLE = {
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--border-subtle)",
  background: "transparent",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
} as const;

export interface DocumentSpeechBarProps {
  /** The page's speech key, from `docSpeechKey` — `doc:` plus its projects-relative path. */
  docKey: string;
  /** The unit a hovered block of the page would start at (`PlayFromHere`): its segment is outlined. */
  hintUnit?: number | null;
}

/**
 * The document speech bar: the shared transport for one page's key, then the
 * page audio cache's share of it — "N of M cached · size" — and Clear cache,
 * in the mockup's order. A page is not a terminal cell — it is never armed, has no queue
 * to step through and no answer pane to open — so the cell bar's mode switch,
 * previous/next, eye button, launchers and hide toggle have no counterpart here.
 *
 * Everything it shows is read from the panel's one host by the key, the same
 * way the cell bar reads a session: the page's run IS an utterance in the
 * host's channel, so play, pause, resume and a segment jump are the host's
 * ordinary actions on that key.
 *
 * The cache controls are the page's alone: a cell's answers are never cached
 * on disk, so the cell bar (which shares only the transport) has neither.
 * Clear cache shows only while some unit is cached; the label is read through
 * `subscribePageCache`, so it moves as uploads land.
 *
 * The `.speech-bar` / `.speech-bar-row` wrapper is the cell bar's, reused for
 * the flex row the transport's stylesheet expects.
 */
export function DocumentSpeechBar({ docKey, hintUnit = null }: DocumentSpeechBarProps) {
  const speech = usePanelSpeech();
  const pageSpeech = usePageSpeech();
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
  // Resolved by the same speech-side rule the terminal's `voiceForSession`
  // uses for a `doc:` key (speech may not import terminal); both voice
  // preferences are subscribed to only so a change re-reads it.
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  const voice = voiceForDocKey(docKey);

  // One string snapshot, so `useSyncExternalStore` sees an unchanged share as
  // equal — `pageCachedShare` answers a fresh object on every call.
  const shareKey = useSyncExternalStore(subscribePageCache, () => {
    const { cached, bytes } = pageCachedShare(docKey, units);
    return `${cached}:${bytes}`;
  });
  const [cached, bytes] = shareKey.split(":").map(Number);
  const [clearing, setClearing] = useState(false);

  const clearCache = async (): Promise<void> => {
    // The run goes first, so nothing it plays or warms lands after the clear.
    // A stop, not `stopDocument`: the latter also forgets the page — its
    // utterance, preparation and units — which would empty this very bar's
    // scrubber. Clearing the cache stops the audio; the page stays loaded.
    // Only when the page's run owns the player: an answer playing while the
    // page merely warms keeps speaking.
    pageSpeech.stopPageRun(docKey);
    setClearing(true);
    try {
      await clearPage(docKey);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      alerts.error(`Couldn't clear the cache: ${reason}`);
    } finally {
      setClearing(false);
    }
  };

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
          hintUnit={hintUnit}
        />
        {units.length > 0 && (
          <span data-testid={`speech-bar-cached-${docKey}`} style={LABEL_STYLE}>
            {cached > 0
              ? `${cached} of ${units.length} cached · ${formatBytes(bytes)}`
              : `0 of ${units.length} cached`}
          </span>
        )}
        {cached > 0 && (
          <button
            type="button"
            data-testid={`speech-bar-clear-cache-${docKey}`}
            title="Delete this page's cached audio"
            disabled={clearing}
            onClick={() => void clearCache()}
            style={{ ...CLEAR_STYLE, opacity: clearing ? 0.6 : 1 }}
          >
            Clear cache
          </button>
        )}
      </div>
    </div>
  );
}

export default DocumentSpeechBar;
