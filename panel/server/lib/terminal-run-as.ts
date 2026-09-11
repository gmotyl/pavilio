import type { OsUser } from "./os-users";

/**
 * Pure helpers for constructing the spawn command that runs a terminal
 * session as a different OS account (`runAsUser`). No I/O, no node-pty here —
 * `terminal-manager.ts` is the caller that actually spawns the process.
 */

/**
 * Swaps `<ownerHomeDir>/git/` for `<targetHomeDir>/git/`; passes cwd through
 * unchanged if it doesn't start with that prefix.
 */
export function translateCwd(
  cwd: string,
  ownerHomeDir: string,
  targetHomeDir: string,
): string {
  const ownerGitPrefix = `${ownerHomeDir.replace(/\/+$/, "")}/git/`;
  if (!cwd.startsWith(ownerGitPrefix)) return cwd;
  const targetGitPrefix = `${targetHomeDir.replace(/\/+$/, "")}/git/`;
  return targetGitPrefix + cwd.slice(ownerGitPrefix.length);
}

/**
 * Wraps `value` in single quotes for embedding in a `su -c` string, escaping
 * embedded single quotes.
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface RunAsSpawnCommand {
  file: string;
  args: string[];
}

/**
 * `su - <user> -c "cd <quoted-cwd> && PAVILIO_TERMINAL_ID=<id>
 * [PAVILIO_PANEL_URL=<url> ]exec <shell> -l"`. Always the `su` form — the
 * inline assignments are the only way anything from this process's
 * environment survives: `su -` starts a login shell and resets the
 * environment, so the `{ ...process.env }` the caller hands node-pty reaches
 * a normal terminal but never this one.
 *
 * **Only non-secrets belong in that command string.** A `su -c` command line
 * is visible in `ps aux` to every account on the machine, so the panel's URL
 * (loopback, not a secret) is fine here and `PANEL_TOKEN` is deliberately
 * not — putting it here would leak it system-wide.
 *
 * The accounts this switches between are plain
 * Linux logins (the same ones `workspace-setup`'s account provisioning
 * manages via `su -`, never `wsl.exe`) regardless of whether the panel
 * process itself happens to have `WSL_DISTRO_NAME` set. An earlier version
 * branched on that env var and shelled out to `wsl.exe -d <distro> -u <user>`
 * instead; invoked from a process already attached to a real pty, that hangs
 * indefinitely (confirmed: never exits, never errors, never produces a
 * shell) — `su` doesn't have that problem and is what these accounts were
 * built around in the first place.
 */
export function buildRunAsSpawnCommand(opts: {
  user: OsUser;
  cwd: string;
  sessionId: string;
  /**
   * Printed (via `echo`) before the `cd`, when the caller already decided to
   * land somewhere other than what the user actually asked for — e.g.
   * falling back to the target's home because the intended path doesn't
   * exist for that account. Keeps that substitution visible in the terminal
   * instead of a session that just silently opens somewhere unexpected.
   */
  notice?: string;
  /**
   * Where the panel actually ended up listening, as `startPanel` resolved it
   * (`http://127.0.0.1:<port>`). Passed through so the speech `Stop` hook
   * inside this session posts to the running panel instead of its hard-coded
   * default port, which a stale panel may well be holding. Omitted from the
   * command entirely when undefined, leaving the hook on that default.
   */
  panelUrl?: string;
}): RunAsSpawnCommand {
  const { user, cwd, sessionId, notice, panelUrl } = opts;
  const noticePrefix = notice !== undefined ? `echo ${shQuote(notice)} && ` : "";
  // Quoted like every other interpolation here: the value comes from this
  // process's environment, and an unquoted assignment would be an injection
  // hole the moment it is anything but a bare URL.
  const panelUrlAssignment =
    panelUrl !== undefined ? `PAVILIO_PANEL_URL=${shQuote(panelUrl)} ` : "";

  return {
    file: "su",
    args: [
      "-",
      user.username,
      "-c",
      `${noticePrefix}cd ${shQuote(cwd)} && PAVILIO_TERMINAL_ID=${sessionId} ${panelUrlAssignment}exec ${shQuote(user.shell)} -l`,
    ],
  };
}
