import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { noteLauncherUsed, useLauncherUsed } from "./launcherUse";
import { getSessions } from "./sessionStore";

export interface LauncherPillsProps {
  /** Only for test ids — the pills act on the `send` they are handed. */
  sessionId: string;
  /** The cell's PTY write, straight off its terminal instance. */
  send: (data: string) => void;
}

/** The workspace command that loads a project's context into a fresh agent. */
const SESSION_START = "pavilio-session-start";

/**
 * `pavilio-session-start` for this cell, argument included when the tab knows
 * the cell's project.
 *
 * Built HERE, at click time, rather than read during render: the row does not
 * subscribe to the session store, so a command composed in render would be
 * whatever the store held when the pills last drew. The list is tab-wide and
 * already live — every grid subscribes to it — so the freshest answer is the
 * one taken at the moment the command is sent.
 *
 * An unknown or blank project yields the bare command, which is a valid
 * invocation: the skill then asks which project rather than being handed the
 * word `undefined`, and there is no trailing space to type a stray argument
 * separator into the prompt.
 */
function sessionStartCommand(sessionId: string): string {
  const project = getSessions().find((session) => session.id === sessionId)?.project?.trim();
  return project ? `${SESSION_START} ${project}` : SESSION_START;
}

/**
 * The launcher row: one pill per configured launcher, filling the reserved
 * speech row until the cell has something to play.
 *
 * ## Why it reads the preference itself
 *
 * The bar's other props are per-cell state the grid already holds; the launcher
 * list is one global choice shared by every silent cell in the panel. Threading
 * it down through the surface, the grid and the cell would make every one of
 * them a passer-through of a value none of them uses, and `usePreference`
 * subscribes — so an entry added on the Settings page appears on every silent
 * cell at once, with no surface having to know it happened.
 *
 * ## Why it reads the session store for the project, too
 *
 * The same argument, for the same reason. The project is per-cell, but no cell
 * holds it: `TerminalView` is handed a `sessionId` and nothing else, and it is
 * rendered by the grid, the mobile rail, the maximized stack and the quick
 * modal — so threading `project` down to this row would add a prop to four
 * hosts and a view that none of them would read. `sessionStore` is the tab's
 * one list, keyed by exactly the id this row already has, and it is what the
 * grids themselves resolve a session through.
 *
 * ## Why the label and the command are separate
 *
 * The name is the pill's text and the command is what the PTY receives. They
 * are the same word in all three defaults, which is exactly why they are read
 * from different fields here: an entry named `resume` running `claude --resume`
 * must show the short name and run the long command, and code that showed
 * `entry.command` would pass every default and fail the first real edit.
 *
 * ## Why a used row offers to start the session
 *
 * The bar swaps the pills for the transport when the cell has SPOKEN, and that
 * is a later moment than launching: an agent loads, prints a banner and works
 * before its first hook fires. For the whole of that window the row showed
 * launcher pills, and pressing one does not start a second agent — it types
 * `claude` into the prompt of the one already running.
 *
 * The first version answered that by greying the pills out, and a row of three
 * dead buttons is not worth the width it sits in. What Greg actually does in
 * that window is type `pavilio-session-start <project>` by hand the moment the
 * agent finishes booting, so that is what the row now carries: one live pill,
 * in place of the launchers, sending exactly that.
 *
 * It stays live on purpose. Re-issuing it is legitimate — unlike launching a
 * second agent into a running one — and its effect is visible in the prompt,
 * so nothing has to be guessed from a pill's state.
 *
 * The row does not shrink when it swaps: the pills and the start pill share the
 * `.speech-bar-launchers` strip, whose height is fixed, inside a row of a fixed
 * 56px spent at mount so that no box moves under a running TUI.
 *
 * Commands are sent with a trailing `\r` — the return that runs them — and
 * nothing else. Never mutate `launchers` or its members: `readPreference` hands
 * the declared `DEFAULT_TERMINAL_LAUNCHERS` back BY REFERENCE when nothing is
 * stored, so an in-place edit here would rewrite the defaults for the session.
 */
export function LauncherPills({ sessionId, send }: LauncherPillsProps) {
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const launched = useLauncherUsed(sessionId);

  return (
    <div className="speech-bar-launchers" data-testid={`speech-bar-launchers-${sessionId}`}>
      {launched ? (
        <button
          type="button"
          // No command tooltip, deliberately. A launcher pill needs one because
          // its label is a nickname for a command it hides; this label is the
          // command's own word, and the argument is the cell's own project. A
          // tooltip would also have to be composed in render, which is the one
          // place this row has no live answer to compose it from.
          data-testid={`speech-bar-start-${sessionId}`}
          className="speech-bar-launch"
          onClick={() => send(`${sessionStartCommand(sessionId)}\r`)}
        >
          start
        </button>
      ) : (
        launchers.map((entry, index) => (
          <button
            // Index keys, as in the editor: two entries may legally carry the
            // same name, and the list's order is the user's, so position is the
            // only stable identity.
            key={index}
            type="button"
            // The accessible name is the pill's label — the name, not the
            // command. The command is a hover tooltip, so a pointer user can see
            // what a pill will run before running it.
            title={entry.command}
            data-testid={`speech-bar-launch-${sessionId}-${index}`}
            className="speech-bar-launch"
            onClick={() => {
              send(`${entry.command}\r`);
              noteLauncherUsed(sessionId);
            }}
          >
            {entry.name}
          </button>
        ))
      )}
    </div>
  );
}

export default LauncherPills;
