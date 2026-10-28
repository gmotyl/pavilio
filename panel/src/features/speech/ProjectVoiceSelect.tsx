import { useMemo, useRef, type CSSProperties } from "react";
import { listEngines, listVoices } from "anytts";

import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { CASCADE } from "./engines";
import { isKeyless, useEngineInfo, type EngineInfo } from "./useEngineInfo";
import { SPEECH_ROWS_NARROW_BELOW, usePaneWidth } from "./usePaneWidth";
import { groupVoices } from "./voiceGroups";
import {
  catalogDefaultVoice,
  getCascadeOrder,
  getProjectVoice,
  getProjectVoices,
  getStoredEngine,
  getStoredVoices,
  resolveStoredVoice,
  setProjectEngineVoice,
  setProjectVoice,
} from "./voices";

const SELECT_CLASS = "text-sm px-2 py-1.5 rounded";
const SELECT_STYLE: CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};
const MUTED: CSSProperties = { color: "var(--text-muted)" };

function browserLanguage(): string {
  return typeof navigator === "undefined" ? "" : navigator.language;
}

/**
 * One project's voice picker, for the project's Overview.
 *
 * The engine is global — Settings picks it, the project card never does — so
 * this control follows it: a single engine gets one voice select, the Cascade
 * one select per member engine ({@link CascadeProjectVoices}).
 *
 * The preferences are read through `usePreference` only to subscribe: a change
 * from anywhere — the Settings picker, another tab — re-renders this control.
 * The values themselves still go through `voices.ts`, which owns the boundary
 * that maps a stale or hand-edited id onto a real voice (or onto "no override").
 */
export function ProjectVoiceSelect({ project }: { project: string }) {
  usePreference(preferences.speechEngine);
  return getStoredEngine() === CASCADE ? (
    <CascadeProjectVoices project={project} />
  ) : (
    <SingleEngineVoiceSelect project={project} />
  );
}

/**
 * The single-engine picker. "Default" is a real option (value `""`) labelled
 * with the voice it currently resolves to, so "no override" is visible rather
 * than implied; picking it DELETES the project's entry, and the project follows
 * the Settings voice again. The other options are the global engine's catalog —
 * a project voice is a voice of that engine — in the same groups the Settings
 * picker shows.
 *
 * The default is resolved read-only here; writing a fallen-back default back
 * is the Settings picker's job, not a render side effect of this one.
 */
function SingleEngineVoiceSelect({ project }: { project: string }) {
  const [storedDefault] = usePreference(preferences.speechVoice);
  // Subscription only: the record is re-read on each render.
  usePreference(preferences.speechVoiceByProject);

  const engine = getStoredEngine();
  const catalog = useMemo(() => listVoices(engine), [engine]);
  const groups = useMemo(() => groupVoices(catalog, browserLanguage()), [catalog]);
  const defaultVoice = resolveStoredVoice(storedDefault).voice;
  const defaultLabel = catalog.find((voice) => voice.id === defaultVoice)?.label ?? defaultVoice;
  const override = getProjectVoice(project);

  const selectId = `project-voice-${project}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label htmlFor={selectId} className="block text-xs" style={MUTED}>
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
        className={SELECT_CLASS}
        style={SELECT_STYLE}
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
      <p className="text-xs mt-2" style={MUTED}>
        Reads answers from this project's terminals. “Default” follows the voice on Settings.
      </p>
    </div>
  );
}

/**
 * Under the Cascade: the member engines — those *In cascade*, in Settings'
 * order — each with this project's voice for that engine. These are the very
 * entries a single engine's picker writes (`speech.voiceByProject[project][engine]`),
 * so a voice picked here is the one the project uses with that engine on its
 * own too. A member the cascade skips for want of a key is greyed and its
 * select disabled, on the server's word only.
 */
function CascadeProjectVoices({ project }: { project: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = usePaneWidth(rootRef);
  const narrow = width > 0 && width < SPEECH_ROWS_NARROW_BELOW;
  const { engines } = useEngineInfo();
  // Subscriptions: each value is read through `voices.ts` below.
  usePreference(preferences.speechCascadeOrder);
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);

  const members = getCascadeOrder().filter((entry) => entry.on);
  const own = getProjectVoices(project);
  const defaults = getStoredVoices();
  const labels = useMemo(() => new Map(listEngines().map((engine) => [engine.id, engine.label])), []);

  return (
    <div ref={rootRef} style={{ minWidth: 0 }}>
      <span className="block text-xs mb-1" style={MUTED}>
        Speech voices
      </span>
      <p data-testid="project-cascade-help" className="text-xs" style={MUTED}>
        Cascade speaks with these voices, in this order. Each one is the voice this project uses
        with that engine on its own. Order is set in Settings → Speech.
      </p>
      <ol
        data-testid="project-cascade-voices"
        data-narrow={narrow ? "true" : "false"}
        className="mt-2 grid gap-1.5"
        style={{ listStyle: "none", padding: 0, minWidth: 0 }}
      >
        {members.map((entry, index) => (
          <MemberVoiceRow
            key={entry.id}
            project={project}
            engine={entry.id}
            label={labels.get(entry.id) ?? entry.id}
            position={index + 1}
            narrow={narrow}
            info={engines?.[entry.id]}
            override={own[entry.id] ?? null}
            defaultVoice={defaults[entry.id] ?? catalogDefaultVoice(entry.id)}
          />
        ))}
      </ol>
      <p className="text-xs mt-2" style={MUTED}>
        Reads answers from this project's terminals. “Default” follows each engine's voice on
        Settings.
      </p>
    </div>
  );
}

interface MemberVoiceRowProps {
  project: string;
  engine: string;
  label: string;
  position: number;
  narrow: boolean;
  info: EngineInfo | undefined;
  override: string | null;
  defaultVoice: string | undefined;
}

function MemberVoiceRow(props: MemberVoiceRowProps) {
  const { project, engine, label, narrow, override } = props;
  const skipped = isKeyless(props.info);
  const catalog = useMemo(() => listVoices(engine), [engine]);
  const groups = useMemo(() => groupVoices(catalog, browserLanguage()), [catalog]);
  const defaultLabel =
    catalog.find((voice) => voice.id === props.defaultVoice)?.label ?? props.defaultVoice ?? "";
  // The wide row is position · engine · select; narrow, the select and its
  // notes drop under the engine name, so nothing needs a fixed width.
  const detailColumn = narrow ? "2" : "3";

  return (
    <li
      data-testid={`project-voice-row-${engine}`}
      data-skipped={skipped ? "true" : "false"}
      className="rounded-md text-sm"
      style={{
        display: "grid",
        gridTemplateColumns: narrow ? "22px minmax(0, 1fr)" : "22px minmax(90px, 140px) minmax(0, 1fr)",
        alignItems: "center",
        gap: "6px 10px",
        padding: "6px 8px",
        background: "var(--bg-elevated)",
        opacity: skipped ? 0.62 : 1,
        minWidth: 0,
      }}
    >
      <span
        data-testid="project-voice-position"
        className="inline-grid place-items-center text-xs rounded-full"
        style={{ width: 22, height: 22, background: "var(--bg-active)", color: "var(--text-secondary)" }}
      >
        {props.position}
      </span>
      <span style={{ color: "var(--text-primary)", minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      <select
        aria-label={`${label} voice for this project`}
        value={override ?? ""}
        disabled={skipped}
        onChange={(e) => {
          const id = e.target.value;
          // An id outside the engine's catalog is ignored; "" clears the override.
          setProjectEngineVoice(project, engine, id === "" ? null : id);
        }}
        className={SELECT_CLASS}
        style={{ ...SELECT_STYLE, gridColumn: detailColumn, width: "100%", minWidth: 0 }}
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
      {override !== null && (
        <span
          data-testid={`project-voice-override-${engine}`}
          className="text-xs"
          style={{ gridColumn: detailColumn, color: "var(--accent)" }}
        >
          {`overrides default (${defaultLabel})`}
        </span>
      )}
      {skipped && (
        <span
          data-testid="project-voice-skipped"
          className="text-xs"
          style={{ gridColumn: detailColumn, color: "var(--text-tertiary)" }}
        >
          skipped — no API key
        </span>
      )}
    </li>
  );
}
