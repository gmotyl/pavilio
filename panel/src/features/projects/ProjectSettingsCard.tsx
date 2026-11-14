import { Settings } from "lucide-react";
import { preferences } from "../../preferences/declarations";
import { useScopedPreference } from "../../preferences/usePreference";
import { ProjectVoiceSelect } from "../speech/ProjectVoiceSelect";
import AppearanceEditor from "./AppearanceEditor";

/**
 * The project's own settings, on its Overview tab: the voice its terminals'
 * answers are read in, how far the answer panel's bottom edge fades, and the
 * mark and colour that identify it.
 *
 * Each row's control brings its own label and help where it has them — the
 * voice select renders "Speech voice", its help line and the "overrides
 * default" tag itself, so the card adds none of those.
 */
export default function ProjectSettingsCard({ project }: { project: string }) {
  const titleId = `project-settings-${project}`;
  return (
    <section
      data-testid="project-settings-card"
      aria-labelledby={titleId}
      className="rounded-lg"
      style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)" }}
    >
      <div
        id={titleId}
        className="flex items-center gap-2 px-3.5 py-2.5 text-xs uppercase tracking-wider"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Settings aria-hidden="true" className="w-3.5 h-3.5" />
        Project settings
      </div>
      <div className="px-3.5 py-3">
        <ProjectVoiceSelect project={project} />
      </div>
      <div className="px-3.5 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <AnswerOpacitySlider project={project} />
      </div>
      <div className="px-3.5 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <AppearanceEditor project={project} />
      </div>
    </section>
  );
}

/**
 * The answer body's bottom-edge opacity for this project, 0–100 in steps of 5.
 * No preview here on purpose: every open answer pane reads the same
 * preference, so the effect is visible at once in the terminals themselves.
 */
function AnswerOpacitySlider({ project }: { project: string }) {
  const [opacity, setOpacity] = useScopedPreference(preferences.answerOpacityBottom, project);
  const id = `project-settings-answer-opacity-${project}`;
  const readout = `${opacity}%`;
  return (
    <div data-testid="project-settings-answer-opacity-row">
      <label htmlFor={id} className="block text-sm" style={{ color: "var(--text-primary)" }}>
        Answer panel opacity (bottom)
      </label>
      <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
        Top stays solid; the bottom fades to this value.
      </div>
      <div className="flex items-center gap-3 mt-2">
        <input
          id={id}
          data-testid="project-settings-answer-opacity"
          type="range"
          min={0}
          max={100}
          step={5}
          value={opacity}
          aria-valuetext={readout}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="flex-1"
        />
        <span
          data-testid="project-settings-answer-opacity-value"
          className="font-mono text-xs w-10 text-right"
          style={{ color: "var(--text-secondary)" }}
        >
          {readout}
        </span>
      </div>
    </div>
  );
}
