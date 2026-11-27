import { HardDrive, Trash2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { alerts } from "../alerts/store";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { formatBytes } from "./formatBytes";
import { clearPage, loadPageList, pageCachedShare, subscribePageCache } from "./pageCache";
import { SpeechRow } from "./SpeechRow";
import { usePageSpeech, usePanelSpeech } from "./SpeechHostProvider";
import { usePocketVoicesSnapshot } from "./usePocketVoices";
import { useOpenaiVoicesSnapshot } from "./useOpenaiVoices";
import { projectOfDocVoice, voiceForDocKey } from "./voices";

const LABEL_STYLE = {
  fontSize: 12,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
} as const;

/**
 * The page cache toggle's label per state: it names the state AND what a click
 * does, the way the cell's speech-mode control reads.
 */
const PAGE_CACHE_LABEL = {
  on: "Page cache on — click to turn off",
  off: "Page cache off — click to turn on",
} as const;

export interface DocumentSpeechBarProps {
  /** The page's speech key, from `docSpeechKey` — `doc:` plus its projects-relative path. */
  docKey: string;
  /** The unit a hovered block of the page would start at (`PlayFromHere`): its segment is outlined. */
  hintUnit?: number | null;
}

/**
 * The page's speech row: a slot-filling adapter over `SpeechRow`. Lead is the
 * page cache toggle (`speech.pageCacheEnabled`), then play/pause + scrubber,
 * then the page audio cache's share of the page — "N of M cached · size" — and
 * last the clear-cache icon. A page is not a terminal cell — it is never armed,
 * has no queue to step through and no answer pane to open — so the cell row's
 * mode switch, previous/next, eye button and launchers have no counterpart here.
 *
 * Everything it shows is read from the panel's one host by the key, the same
 * way the cell bar reads a session: the page's run IS an utterance in the
 * host's channel, so play, pause, resume and a segment jump are the host's
 * ordinary actions on that key.
 *
 * The cache controls are the page's alone: a cell's answers are never cached
 * on disk, so the cell row (which shares only the transport) has neither.
 * The clear-cache icon is always on the row — a control that comes and goes
 * moves the row — and is disabled while nothing is cached, unless a clear
 * failed: that clear emptied the listing, which then no longer says what is on
 * disk. The share is read through `subscribePageCache`, so it moves as uploads
 * land. The toggle reads the preference through `usePreference`, so every
 * mounted page row follows a flip.
 */
export function DocumentSpeechBar({ docKey, hintUnit = null }: DocumentSpeechBarProps) {
  const speech = usePanelSpeech();
  const pageSpeech = usePageSpeech();
  const units = speech.unitsFor(docKey);
  const [cacheEnabled, setCacheEnabled] = usePreference(preferences.speechPageCacheEnabled);

  // The voice the page's units were synthesized in — its project's, else the
  // default — or a cached unit reads as cold: the cache keys on voice + text.
  // Resolved by the same speech-side rule the terminal's `voiceForSession`
  // uses for a `doc:` key (speech may not import terminal); both voice
  // preferences are subscribed to only so a change re-reads it.
  // So is the live OmniVoice list, which a saved openai voice waits for.
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  usePreference(preferences.speechEngine);
  usePreference(preferences.speechEngineByProject);
  useOpenaiVoicesSnapshot();
  usePocketVoicesSnapshot();
  const voice = voiceForDocKey(docKey);

  // One string snapshot, so `useSyncExternalStore` sees an unchanged share as
  // equal — `pageCachedShare` answers a fresh object on every call.
  const shareKey = useSyncExternalStore(subscribePageCache, () => {
    const { cached, bytes } = pageCachedShare(docKey, units);
    return `${cached}:${bytes}`;
  });
  const [cached, bytes] = shareKey.split(":").map(Number);
  const [clearing, setClearing] = useState(false);
  // The page whose last clear failed: its listing was emptied locally, and if
  // the re-read failed as well, 0 cached would hide the retry while the audio
  // may still be on disk. Held until a clear succeeds, a listing shows data,
  // or the re-read succeeds — then its count, even 0, is the server's word.
  const [clearFailedKey, setClearFailedKey] = useState<string | null>(null);
  const clearFailed = clearFailedKey === docKey;
  useEffect(() => {
    if (cached > 0) setClearFailedKey((key) => (key === docKey ? null : key));
  }, [cached, docKey]);

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
      setClearFailedKey(null);
    } catch (err) {
      setClearFailedKey(docKey);
      const reason = err instanceof Error ? err.message : String(err);
      alerts.error(`Couldn't clear the cache: ${reason}`);
      // A failed clear still empties the local listing, so the row would read
      // 0 cached and disable the icon while the audio may still be on disk.
      // Re-read it: whatever the server still holds brings the retry back,
      // and a listing actually read settles the state, whatever its count.
      void loadPageList(docKey)
        .then((read) => {
          if (read) setClearFailedKey((key) => (key === docKey ? null : key));
        })
        .catch(() => {});
    } finally {
      setClearing(false);
    }
  };

  const cacheState = cacheEnabled ? "on" : "off";
  const nothingToClear = cached === 0 && !clearFailed;

  return (
    <SpeechRow
      speechKey={docKey}
      speech={speech}
      voice={voice}
      project={projectOfDocVoice(docKey)}
      testIdPrefix="document-speech-bar"
      hintUnit={hintUnit}
      lead={
        <button
          type="button"
          title={PAGE_CACHE_LABEL[cacheState]}
          aria-label={PAGE_CACHE_LABEL[cacheState]}
          aria-pressed={cacheEnabled}
          data-testid={`speech-bar-page-cache-${docKey}`}
          // Styled with the cell's speech-mode looks: on is green, off dimmed.
          data-page-cache={cacheState}
          className="speech-bar-btn"
          onClick={() => setCacheEnabled((enabled) => !enabled)}
        >
          <HardDrive size={17} />
        </button>
      }
      middleExtra={
        units.length > 0 ? (
          <span data-testid={`speech-bar-cached-${docKey}`} style={LABEL_STYLE}>
            {cached > 0
              ? `${cached} of ${units.length} cached · ${formatBytes(bytes)}`
              : clearFailed
                ? "cache state unknown"
                : `0 of ${units.length} cached`}
          </span>
        ) : null
      }
      trail={
        <button
          type="button"
          title="Clear this page's cached audio"
          aria-label="Clear this page's cached audio"
          data-testid={`speech-bar-clear-cache-${docKey}`}
          className="speech-bar-btn"
          disabled={clearing || nothingToClear}
          onClick={() => void clearCache()}
        >
          <Trash2 size={17} />
        </button>
      }
    />
  );
}

export default DocumentSpeechBar;
