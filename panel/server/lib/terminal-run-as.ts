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
 * `su - <user> -c "cd <quoted-cwd> && PAVILIO_TERMINAL_ID=<id> exec <shell>
 * -l"`. Always the `su` form — the accounts this switches between are plain
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
}): RunAsSpawnCommand {
  const { user, cwd, sessionId } = opts;

  return {
    file: "su",
    args: [
      "-",
      user.username,
      "-c",
      `cd ${shQuote(cwd)} && PAVILIO_TERMINAL_ID=${sessionId} exec ${shQuote(user.shell)} -l`,
    ],
  };
}
