import { useMemo, useState } from "react";
import { listEngines, listVoices } from "anytts";

import { groupVoices } from "./voiceGroups";
import { getStoredEngine, getStoredVoice, setStoredEngine, setStoredVoice } from "./voices";

const SELECT_CLASS = "text-sm px-2 py-1.5 rounded";
const SELECT_STYLE = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

/**
 * The engine and default voice pickers. One workspace-wide preference — not a
 * property of a cell or a surface — so they live on the Settings page; a
 * project can override the voice from its Overview → Project settings.
 *
 * The lists are anytts' catalog; `voices.ts` owns the storage keys and the
 * boundary that maps a stale engine or voice onto a real one. `getStoredVoice`
 * resolves the stored voice against the current engine and writes the engine
 * default back when it fell back, so a stale pick is shown as — and becomes —
 * the default. The setters return the value now in effect, so a browser that
 * refuses to store still gets the pick applied for this page view.
 */
export function VoiceSelect() {
  const [engine, setEngine] = useState(getStoredEngine);
  const [voice, setVoice] = useState(getStoredVoice);
  const groups = useMemo(
    () => groupVoices(listVoices(engine), typeof navigator === "undefined" ? "" : navigator.language),
    [engine],
  );

  return (
    <div>
      <label
        htmlFor="speech-engine"
        className="block text-xs mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Engine
      </label>
      <select
        id="speech-engine"
        data-testid="speech-engine-select"
        value={engine}
        onChange={(e) => {
          setEngine(setStoredEngine(e.target.value));
          // The voice list is now the new engine's: re-resolve the stored
          // voice against it, falling back to (and storing) its default.
          setVoice(getStoredVoice());
        }}
        className={`${SELECT_CLASS} mb-3`}
        style={SELECT_STYLE}
      >
        {listEngines().map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <label
        htmlFor="speech-voice"
        className="block text-xs mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Default voice
      </label>
      <select
        id="speech-voice"
        data-testid="speech-voice-select"
        value={voice}
        onChange={(e) => setVoice(setStoredVoice(e.target.value))}
        className={SELECT_CLASS}
        style={SELECT_STYLE}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.voices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Multilingual voices read both Polish and English; a single-language voice
        reads every answer in its own language. Saved in the workspace; a project
        can override it in its Overview → Project settings.
      </p>
    </div>
  );
}
