import { useMemo } from "react";
import { listVoices } from "anytts";

import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { groupVoices } from "./voiceGroups";
import { getProjectVoice, getStoredEngine, resolveStoredVoice, setProjectVoice } from "./voices";

/**
 * One project's voice picker, for the project's Overview.
 *
 * "Default" is a real option (value `""`) labelled with the voice it currently
 * resolves to, so "no override" is visible rather than implied; picking it
 * DELETES the project's entry, and the project follows the Settings voice again.
 * The other options are the global engine's catalog — a project voice is a
 * voice of that engine — in the same groups the Settings picker shows.
 *
 * The preferences are read through `usePreference` only to subscribe: a change
 * from anywhere — the Settings picker, another tab — re-renders this control.
 * The values themselves still go through `voices.ts`, which owns the boundary
 * that maps a stale or hand-edited id onto a real voice (or onto "no override").
 * The default is resolved read-only here; writing a fallen-back default back
 * is the Settings picker's job, not a render side effect of this one.
 */
export function ProjectVoiceSelect({ project }: { project: string }) {
  const [storedDefault] = usePreference(preferences.speechVoice);
  // Subscriptions only: the engine and the record are re-read on each render.
  usePreference(preferences.speechEngine);
  usePreference(preferences.speechVoiceByProject);

  const engine = getStoredEngine();
  const catalog = useMemo(() => listVoices(engine), [engine]);
  const groups = useMemo(
    () => groupVoices(catalog, typeof navigator === "undefined" ? "" : navigator.language),
    [catalog],
  );
  const defaultVoice = resolveStoredVoice(storedDefault).voice;
  const defaultLabel = catalog.find((voice) => voice.id === defaultVoice)?.label ?? defaultVoice;
  const override = getProjectVoice(project);

  const selectId = `project-voice-${project}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label htmlFor={selectId} className="block text-xs" style={{ color: "var(--text-muted)" }}>
          Speech voice
        </label>
        {override !== null && (
          <span
            data-testid="project-voice-override"
            className="text-[11px] px-2 rounded-full"
            style={{ color: "var(--accent)", background: "var(--accent-dim)" }}
          >
            overrides default
          </span>
        )}
      </div>
      <select
        id={selectId}
        data-testid="project-voice-select"
        value={override ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          // `setProjectVoice` ignores an id outside the catalog; "" clears.
          setProjectVoice(project, id === "" ? null : id);
        }}
        className="text-sm px-2 py-1.5 rounded"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <option value="">{`Default — ${defaultLabel}`}</option>
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
        Reads answers from this project's terminals. “Default” follows the voice on Settings.
      </p>
    </div>
  );
}
