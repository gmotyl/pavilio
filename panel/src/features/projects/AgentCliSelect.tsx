import { useProjectLauncher } from "./useProjectLauncher";

/**
 * The project's Agent CLI, for Project settings: one `aria-pressed` button per
 * launcher offered for runs (those with a run loop). The pressed one is the
 * launcher `useProjectLauncher` resolves — the project's own pick, else the
 * workspace fallback — and the "overrides default" tag shows only while the
 * project's own pick is set. A click stores the pick for this project only.
 */
export default function AgentCliSelect({ project }: { project: string }) {
  const { launcher, offered, overridden, setLauncher } = useProjectLauncher(project);
  const labelId = `project-agent-cli-${project}`;

  return (
    <div data-testid="project-settings-agent-cli-row">
      <div className="flex items-center gap-2 mb-1">
        <span id={labelId} className="block text-xs" style={{ color: "var(--text-muted)" }}>
          Agent CLI
        </span>
        {overridden && (
          <span
            data-testid="project-agent-cli-override"
            className="text-[11px] px-2 rounded-full"
            style={{ color: "var(--accent)", background: "var(--accent-dim)" }}
          >
            overrides default
          </span>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex rounded-md overflow-hidden"
        style={{ border: "1px solid var(--border-default)" }}
      >
        {offered.map((entry, index) => {
          const on = entry === launcher;
          return (
            <button
              // Index keys: names may repeat.
              key={index}
              type="button"
              aria-pressed={on}
              onClick={() => setLauncher(entry.name)}
              className="text-xs px-3 py-1"
              style={{
                borderLeft: index === 0 ? undefined : "1px solid var(--border-default)",
                background: on ? "var(--accent-dim)" : "transparent",
                color: on ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {entry.name}
            </button>
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        Which CLI this project's runs start: Run and Archive on a change, and Explain on a PR.
      </p>
    </div>
  );
}
