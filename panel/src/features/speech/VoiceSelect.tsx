import { useEffect, useMemo, useState } from "react";
import { listEngines, listVoices } from "anytts";

import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";
import { speechEngines } from "./engines";
import { SPEECH_ROUTE_OPTIONS, toSpeechRoute } from "./route";
import { groupVoices } from "./voiceGroups";
import {
  getStoredEngine,
  getStoredVoice,
  resolveStoredVoice,
  setStoredEngine,
  setStoredVoice,
} from "./voices";

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
 * boundary that maps a stale engine or voice onto a real one. The first render
 * shows the stored voice resolved READ-ONLY against the current engine; the
 * mount effect then calls `getStoredVoice`, which writes the engine default
 * back when it fell back, so a stale pick is shown as — and becomes — the
 * default. The write stays out of render because it notifies every
 * `speech.voice` subscriber synchronously. Every control shows the value read
 * back after its write — what synthesis will actually use — so a refused write
 * leaves the select on the stored pick rather than on the attempt.
 *
 * The engine options are the seam's configured engines, labelled from anytts'
 * list: an engine anytts lists but the panel does not configure is not offered.
 *
 * The speech route is per device (`speech.route` is non-portable) and is
 * written from the change handler only; `synth.ts` picks it up on its next
 * request.
 */
export function VoiceSelect() {
  const [engine, setEngine] = useState(getStoredEngine);
  const [voice, setVoice] = useState(
    () => resolveStoredVoice(readPreference(preferences.speechVoice)).voice,
  );
  const [route, setRoute] = useState(() =>
    toSpeechRoute(readPreference(preferences.speechRoute)),
  );
  useEffect(() => {
    setVoice(getStoredVoice());
  }, []);
  const engines = useMemo(() => {
    const configured = speechEngines();
    return listEngines().filter((option) => configured.includes(option.id));
  }, []);
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
        {engines.map((option) => (
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
      <label
        htmlFor="speech-route"
        className="block text-xs mt-4 mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Speech route
      </label>
      <select
        id="speech-route"
        data-testid="speech-route-select"
        value={route}
        onChange={(e) => {
          writePreference(preferences.speechRoute, toSpeechRoute(e.target.value));
          // Read back: a refused browser-storage write leaves the old route in
          // effect, and synth.ts reads the stored one on every request.
          setRoute(toSpeechRoute(readPreference(preferences.speechRoute)));
        }}
        className={SELECT_CLASS}
        style={SELECT_STYLE}
      >
        {SPEECH_ROUTE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Kept on this device. Microsoft&apos;s speech service answers only Edge, so other
        browsers always go through the panel server.
      </p>
    </div>
  );
}
