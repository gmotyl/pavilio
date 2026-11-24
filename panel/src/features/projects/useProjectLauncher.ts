import { preferences, type TerminalLauncher } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { resolveRunLoop, type RunLoopState } from "../agents/launcherRunLoop";

export interface ProjectLauncher {
  /** The resolved launcher, or null when no launcher is offered at all. */
  launcher: TerminalLauncher | null;
  /** `resolveRunLoop(launcher)`, or null with no launcher. */
  state: RunLoopState | null;
  /** Launchers offered for runs: those whose run loop is not `none`. */
  offered: TerminalLauncher[];
  /** Whether this project's own pick is set and still offered. */
  overridden: boolean;
  /** Stores `name` as this project's pick; other projects are untouched. */
  setLauncher: (name: string) => void;
}

/**
 * The agent CLI a project runs with. By NAME, so a reordered or shortened
 * launcher list keeps the same CLI: the project's pick (`projectRunLauncher`)
 * when it names an offered launcher, else the workspace pick
 * (`plansRunLauncher`), else the first launcher whose run loop is ready.
 */
export function useProjectLauncher(project: string): ProjectLauncher {
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const [workspacePick] = usePreference(preferences.plansRunLauncher);
  const [projectPick, setProjectPick] = usePreference(preferences.projectRunLauncher, project);

  const entries = launchers.flatMap((launcher) => {
    const state = resolveRunLoop(launcher);
    return state.kind === "none" ? [] : [{ launcher, state }];
  });
  const byName = (name: string | null) =>
    name === null ? undefined : entries.find((entry) => entry.launcher.name === name);

  const own = byName(projectPick);
  const chosen = own ?? byName(workspacePick) ?? entries.find((e) => e.state.kind === "ready");

  return {
    launcher: chosen?.launcher ?? null,
    state: chosen?.state ?? null,
    offered: entries.map((entry) => entry.launcher),
    overridden: own !== undefined,
    setLauncher: (name: string) => setProjectPick(name),
  };
}
