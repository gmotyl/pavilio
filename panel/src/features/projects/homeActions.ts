import type { HomeAction, TerminalLauncher } from "../../preferences/declarations";
import { composeRunLine } from "./runPrompt";

/** The runner name that types the action text into a shell as-is. */
const SHELL_RUNNER = "shell";

/**
 * The line a home action types into a new session: a shell action sends its
 * text verbatim; an agent action is the launcher's command plus the text as
 * its start prompt (no run loop). `null` for a runner that is neither.
 */
export function actionRunLine(a: HomeAction, launchers: TerminalLauncher[]): string | null {
  if (a.runner === SHELL_RUNNER) return a.text;
  const launcher = launchers.find((l) => l.name === a.runner);
  if (!launcher) return null;
  return composeRunLine(launcher.command, launcher.promptFlag ?? "", "{prompt}", a.text);
}

/** Why an action cannot run right now, or `null` when it can. */
export function actionBlocker(
  a: HomeAction,
  launchers: TerminalLauncher[],
  projectNames: ReadonlySet<string>,
): "project missing" | "runner missing" | null {
  if (!projectNames.has(a.project)) return "project missing";
  if (actionRunLine(a, launchers) === null) return "runner missing";
  return null;
}
