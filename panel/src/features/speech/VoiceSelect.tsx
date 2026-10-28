import { useMemo, useState } from "react";
import { listEngines } from "anytts";

import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";
import { speechEngines } from "./engines";
import { SPEECH_ROUTE_OPTIONS, toSpeechRoute } from "./route";
import { getStoredEngine, setStoredEngine } from "./voices";

const SELECT_CLASS = "text-sm px-2 py-1.5 rounded";
const SELECT_STYLE = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

/**
 * The default engine and the speech route. The engine is one workspace-wide
 * preference — not a property of a cell or a surface — so it lives on the
 * Settings page.
 *
 * Voices are not picked here: every engine keeps its own voice, set in its row
 * of {@link import("./EngineSettings").EngineSettings} — the voice it speaks
 * with on its own and as a cascade member — so a single "default voice" select
 * would duplicate one of those rows (and mean nothing under the cascade).
 *
 * The engine options are the seam's configured engines, `cascade` among them,
 * labelled from anytts' list: an engine anytts lists but the panel does not
 * configure is not offered. The select shows the engine read back after its
 * write — what synthesis will actually use — so a refused write leaves it on
 * the stored engine rather than on the attempt.
 *
 * The speech route is per device (`speech.route` is non-portable) and is
 * written from the change handler only; `synth.ts` picks it up on its next
 * request.
 */
export function VoiceSelect() {
  const [engine, setEngine] = useState(getStoredEngine);
  const [route, setRoute] = useState(() =>
    toSpeechRoute(readPreference(preferences.speechRoute)),
  );
  const engines = useMemo(() => {
    const configured = speechEngines();
    return listEngines().filter((option) => configured.includes(option.id));
  }, []);

  return (
    <div>
      <label
        htmlFor="speech-engine"
        className="block text-xs mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        Default engine
      </label>
      <select
        id="speech-engine"
        data-testid="speech-engine-select"
        value={engine}
        onChange={(e) => {
          setEngine(setStoredEngine(e.target.value));
        }}
        className={`${SELECT_CLASS} mb-2`}
        style={SELECT_STYLE}
      >
        {engines.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Cascade speaks through the engines below, in their order. Each engine&apos;s voice is set
        in its row; a project can override voices in its Overview → Project settings.
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
