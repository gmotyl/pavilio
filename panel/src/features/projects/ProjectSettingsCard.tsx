import { Settings } from "lucide-react";
import { ProjectVoiceSelect } from "../speech/ProjectVoiceSelect";
import { ProjectColorPicker } from "../terminal/ProjectColorPicker";

/**
 * The project's own settings, on its Overview tab: the voice its terminals'
 * answers are read in, and the colour its terminals are accented with.
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
        <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
          Project color
        </div>
        <ProjectColorPicker project={project} variant="inline" />
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Accent for this project's terminals. Same picker as in the terminals view; a colour
          another project already uses shows that project's name.
        </p>
      </div>
    </section>
  );
}
