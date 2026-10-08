import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import {
  SPEECH_VOICES,
  getProjectVoice,
  isSpeechVoice,
  resolveVoice,
  setProjectVoice,
} from "./voices";

/**
 * One project's voice picker, for the project's Overview.
 *
 * "Default" is a real option (value `""`) labelled with the voice it currently
 * resolves to, so "no override" is visible rather than implied; picking it
 * DELETES the project's entry, and the project follows the Settings voice again.
 *
 * Both preferences are read through `usePreference` only to subscribe: a change
 * from anywhere — the Settings picker, another tab — re-renders this control.
 * The values themselves still go through `voices.ts`, which owns the boundary
 * that maps a stale or hand-edited id onto a real voice (or onto "no override").
 */
export function ProjectVoiceSelect({ project }: { project: string }) {
  const [storedDefault] = usePreference(preferences.speechVoice);
  // Subscription only: getProjectVoice re-reads the record on each render.
  usePreference(preferences.speechVoiceByProject);

  const defaultVoice = resolveVoice(storedDefault);
  const defaultLabel =
    SPEECH_VOICES.find((voice) => voice.id === defaultVoice)?.label ?? defaultVoice;
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
          setProjectVoice(project, isSpeechVoice(id) ? id : null);
        }}
        className="text-sm px-2 py-1.5 rounded"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <option value="">{`Default — ${defaultLabel}`}</option>
        {SPEECH_VOICES.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Reads answers from this project's terminals. “Default” follows the voice on Settings.
      </p>
    </div>
  );
}
