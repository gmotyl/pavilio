import { describe, it, expect } from "vitest";

import {
  translateCwd,
  shQuote,
  buildRunAsSpawnCommand,
} from "../terminal-run-as";
import type { OsUser } from "../os-users";

describe("translateCwd", () => {
  it("translateCwd swaps the owner home prefix for the target home", () => {
    expect(
      translateCwd("/home/greg/git/prv/pavilio", "/home/greg", "/home/greg-ip"),
    ).toBe("/home/greg-ip/git/prv/pavilio");
  });

  it("translateCwd passes cwd through unchanged when it has no known prefix", () => {
    expect(
      translateCwd("/opt/somewhere/else", "/home/greg", "/home/greg-ip"),
    ).toBe("/opt/somewhere/else");
  });

  it("translateCwd handles a trailing slash on ownerHomeDir without a double slash", () => {
    expect(
      translateCwd("/home/greg/git/prv/pavilio", "/home/greg/", "/home/greg-ip"),
    ).toBe("/home/greg-ip/git/prv/pavilio");
  });
});

describe("shQuote", () => {
  it("shQuote escapes an embedded single quote", () => {
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("buildRunAsSpawnCommand", () => {
  const user: OsUser = {
    username: "greg-ip",
    homeDir: "/home/greg-ip",
    shell: "/bin/zsh",
  };

  it("buildRunAsSpawnCommand always returns the su form", () => {
    // No wsl.exe branch: those accounts are plain Linux logins, switched to
    // via `su -` (matching workspace-setup's own account provisioning),
    // regardless of whether the panel process has WSL_DISTRO_NAME set.
    // wsl.exe -d <distro> -u <user>, invoked from a process already attached
    // to a real pty, hangs indefinitely and never produces a shell.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip/git/prv/pavilio",
      sessionId: "abc-123",
    });
    expect(result).toEqual({
      file: "su",
      args: [
        "-",
        "greg-ip",
        "-c",
        "cd '/home/greg-ip/git/prv/pavilio' && PAVILIO_TERMINAL_ID=abc-123 exec '/bin/zsh' -l",
      ],
    });
  });

  it("buildRunAsSpawnCommand prints an optional notice before landing in cwd", () => {
    // Used when the caller already fell back from a translated-but-missing
    // path to the target's own home: the shell should say so visibly rather
    // than the session just quietly landing somewhere the user didn't ask
    // for, with no explanation.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip",
      sessionId: "abc-123",
      notice: "greg-ip has no ~/git link yet",
    });
    expect(result).toEqual({
      file: "su",
      args: [
        "-",
        "greg-ip",
        "-c",
        "echo 'greg-ip has no ~/git link yet' && cd '/home/greg-ip' && PAVILIO_TERMINAL_ID=abc-123 exec '/bin/zsh' -l",
      ],
    });
  });

  it("buildRunAsSpawnCommand injects the panel URL inline so su - cannot drop it", () => {
    // `su -` resets the environment, so the `{ ...process.env }` handed to
    // node-pty never reaches this session: without an inline assignment the
    // speech hook falls back to its hard-coded default port, which is exactly
    // the port a stale panel was holding when the real one moved up.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip/git/prv/pavilio",
      sessionId: "abc-123",
      panelUrl: "http://127.0.0.1:3012",
    });
    expect(result.args[3]).toBe(
      "cd '/home/greg-ip/git/prv/pavilio' && PAVILIO_TERMINAL_ID=abc-123 " +
        "PAVILIO_PANEL_URL='http://127.0.0.1:3012' exec '/bin/zsh' -l",
    );
  });

  it("buildRunAsSpawnCommand quotes the panel URL rather than splicing it raw", () => {
    // The value arrives from this process's environment, so it is quoted the
    // same way every other interpolation here is. Unquoted, a `;` would end
    // the assignment and run whatever follows as the target user.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip",
      sessionId: "abc-123",
      panelUrl: "http://127.0.0.1:3012'; touch /tmp/pwned; '",
    });
    const command = result.args[3];
    expect(command).toContain(
      `PAVILIO_PANEL_URL='http://127.0.0.1:3012'\\''; touch /tmp/pwned; '\\'''`,
    );
    expect(command).not.toContain("; touch /tmp/pwned; exec");
  });

  it("buildRunAsSpawnCommand omits the panel URL entirely when there is none", () => {
    // No variable set (a panel that never resolved a port, or a unit test):
    // leave the command exactly as it was so the hook keeps its own default
    // rather than inheriting an empty, unusable URL.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip",
      sessionId: "abc-123",
    });
    expect(result.args[3]).not.toContain("PAVILIO_PANEL_URL");
    expect(result.args[3]).toBe(
      "cd '/home/greg-ip' && PAVILIO_TERMINAL_ID=abc-123 exec '/bin/zsh' -l",
    );
  });

  it("buildRunAsSpawnCommand never puts PANEL_TOKEN into the su -c command", () => {
    // A `su -c` command line is visible in `ps aux` to every account on the
    // machine. The URL is not a secret and belongs there; the token is and
    // does not — carrying it must use a mechanism that keeps it off the
    // process list.
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip",
      sessionId: "abc-123",
      panelUrl: "http://127.0.0.1:3012",
    });
    expect(result.args.join(" ")).not.toContain("PANEL_TOKEN");
  });
});
