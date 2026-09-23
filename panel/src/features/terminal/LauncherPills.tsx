import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

export interface LauncherPillsProps {
  /** Only for test ids — the pills act on the `send` they are handed. */
  sessionId: string;
  /** The cell's PTY write, straight off its terminal instance. */
  send: (data: string) => void;
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
 * ## Why the label and the command are separate
 *
 * The name is the pill's text and the command is what the PTY receives. They
 * are the same word in all three defaults, which is exactly why they are read
 * from different fields here: an entry named `resume` running `claude --resume`
 * must show the short name and run the long command, and code that showed
 * `entry.command` would pass every default and fail the first real edit.
 *
 * The command is sent with a trailing `\r` — the return that runs it — and
 * nothing else. Never mutate `launchers` or its members: `readPreference` hands
 * the declared `DEFAULT_TERMINAL_LAUNCHERS` back BY REFERENCE when nothing is
 * stored, so an in-place edit here would rewrite the defaults for the session.
 */
export function LauncherPills({ sessionId, send }: LauncherPillsProps) {
  const [launchers] = usePreference(preferences.terminalLaunchers);

  return (
    <div className="speech-bar-launchers" data-testid={`speech-bar-launchers-${sessionId}`}>
      {launchers.map((entry, index) => (
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
          onClick={() => send(`${entry.command}\r`)}
        >
          {entry.name}
        </button>
      ))}
    </div>
  );
}

export default LauncherPills;
