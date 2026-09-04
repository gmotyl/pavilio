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
 * Wraps `value` in single quotes for embedding in a `su -c` / `wsl.exe -e`
 * string, escaping embedded single quotes.
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface RunAsSpawnCommand {
  file: string;
  args: string[];
}

/**
 * `wslDistro` set => WSL branch: `wsl.exe -d <distro> -u <user> --cd <cwd>
 * --shell-type login -e <shell> -l -c "PAVILIO_TERMINAL_ID=<id> exec <shell>
 * -l"`. `wslDistro` undefined => posix branch: `su - <user> -c "cd
 * <quoted-cwd> && PAVILIO_TERMINAL_ID=<id> exec <shell> -l"`.
 *
 * The two branches look parallel but aren't: `su -c` hands its whole string
 * to the target user's shell for interpretation, so one combined string
 * works. `wsl.exe -e` execs argv directly with no shell in between — passing
 * it a single "PAVILIO_TERMINAL_ID=... exec ... -l" string makes it look for
 * a literal binary of that name and fail (execvpe ENOENT), killing the
 * session before any prompt appears. The shell binary plus `-l -c <command>`
 * must be separate argv elements so the shell itself does the interpreting.
 */
export function buildRunAsSpawnCommand(opts: {
  user: OsUser;
  cwd: string;
  sessionId: string;
  wslDistro: string | undefined;
}): RunAsSpawnCommand {
  const { user, cwd, sessionId, wslDistro } = opts;

  if (wslDistro !== undefined) {
    return {
      file: "wsl.exe",
      args: [
        "-d",
        wslDistro,
        "-u",
        user.username,
        "--cd",
        cwd,
        "--shell-type",
        "login",
        "-e",
        user.shell,
        "-l",
        "-c",
        `PAVILIO_TERMINAL_ID=${sessionId} exec ${shQuote(user.shell)} -l`,
      ],
    };
  }

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
