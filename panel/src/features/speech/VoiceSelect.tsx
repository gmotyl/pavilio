import { useState } from "react";

import {
  SPEECH_VOICES,
  getStoredVoice,
  setStoredVoice,
  type SpeechVoiceId,
} from "./voices";

/**
 * The voice picker. One global preference — not a property of a cell or a
 * surface — so it lives on the Settings page.
 *
 * `voices.ts` is the single source: the list, the storage key and the default
 * all come from there, and the picked voice always wins because nothing here
 * consults language detection. `setStoredVoice` returns the voice now in
 * effect, so a browser that refuses to store (private mode, blocked site data)
 * still gets the pick applied for this page view.
 */
export function VoiceSelect() {
  const [voice, setVoice] = useState<SpeechVoiceId>(getStoredVoice);

  return (
    <div>
      <label
        htmlFor="speech-voice"
        className="block text-xs mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Speech voice
      </label>
      <select
        id="speech-voice"
        data-testid="speech-voice-select"
        value={voice}
        onChange={(e) => setVoice(setStoredVoice(e.target.value))}
        className="text-sm px-2 py-1.5 rounded"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {SPEECH_VOICES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Every voice reads both Polish and English. The pick is stored in this
        browser and is never switched automatically.
      </p>
    </div>
  );
}
