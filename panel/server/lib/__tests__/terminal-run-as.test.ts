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

  it("buildRunAsSpawnCommand returns the wsl.exe form when wslDistro is set", () => {
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip/git/prv/pavilio",
      sessionId: "abc-123",
      wslDistro: "Ubuntu",
    });
    expect(result).toEqual({
      file: "wsl.exe",
      args: [
        "-d",
        "Ubuntu",
        "-u",
        "greg-ip",
        "--cd",
        "/home/greg-ip/git/prv/pavilio",
        "--shell-type",
        "login",
        "-e",
        "PAVILIO_TERMINAL_ID=abc-123 exec /bin/zsh -l",
      ],
    });
  });

  it("buildRunAsSpawnCommand returns the su form when wslDistro is undefined", () => {
    const result = buildRunAsSpawnCommand({
      user,
      cwd: "/home/greg-ip/git/prv/pavilio",
      sessionId: "abc-123",
      wslDistro: undefined,
    });
    expect(result).toEqual({
      file: "su",
      args: [
        "-",
        "greg-ip",
        "-c",
        "cd '/home/greg-ip/git/prv/pavilio' && PAVILIO_TERMINAL_ID=abc-123 exec /bin/zsh -l",
      ],
    });
  });
});
