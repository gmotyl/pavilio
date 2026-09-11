import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "install-speech-hook.mjs",
);

// The installer must register this file; the path is also its identity key.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";

interface HookCommand {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}
interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

let home: string;
let settingsPath: string;

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    // The installer resolves the settings file from HOME, so redirecting HOME
    // keeps every run inside the sandbox and away from the real ~/.claude.
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
}

function readSettings(): Settings {
  return JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
}

function stopEntries(settings: Settings): HookEntry[] {
  return settings.hooks?.Stop ?? [];
}

function allStopCommands(settings: Settings): string[] {
  return stopEntries(settings)
    .flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command ?? "");
}

function speechCommands(settings: Settings): string[] {
  return allStopCommands(settings).filter((command) =>
    command.includes(HOOK_MARKER),
  );
}

const existingSettings = {
  model: "opus",
  permissions: { allow: ["Bash(ls:*)"] },
  hooks: {
    Stop: [
      {
        hooks: [{ type: "command", command: "echo other-stop-hook" }],
      },
    ],
    Notification: [
      {
        hooks: [{ type: "command", command: "echo peon-ping" }],
      },
    ],
  },
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pavilio-install-speech-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  settingsPath = join(home, ".claude", "settings.json");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("install-speech-hook", () => {
  it("merges the Stop entry without disturbing existing hooks", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    const result = run();

    expect(result.status).toBe(0);
    const settings = readSettings();
    expect(speechCommands(settings)).toHaveLength(1);
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");
    expect(settings.hooks?.Notification).toEqual(
      existingSettings.hooks.Notification,
    );
    expect(settings.model).toBe("opus");
    expect(settings.permissions).toEqual(existingSettings.permissions);
  });

  it("is idempotent across repeated runs", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    expect(run().status).toBe(0);
    const afterFirst = readFileSync(settingsPath, "utf8");
    expect(run().status).toBe(0);
    expect(run().status).toBe(0);

    const settings = readSettings();
    expect(speechCommands(settings)).toHaveLength(1);
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");
    // Byte-identical: a second run must not append, reorder or reformat.
    expect(readFileSync(settingsPath, "utf8")).toBe(afterFirst);
  });

  it("removes only its own entry on --uninstall", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    expect(run().status).toBe(0);

    const result = run("--uninstall");

    expect(result.status).toBe(0);
    const settings = readSettings();
    expect(speechCommands(settings)).toHaveLength(0);
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");
    expect(settings.hooks?.Notification).toEqual(
      existingSettings.hooks.Notification,
    );
    expect(settings.model).toBe("opus");
  });

  it("creates the settings file when absent", () => {
    rmSync(join(home, ".claude"), { recursive: true, force: true });
    expect(existsSync(settingsPath)).toBe(false);

    const result = run();

    expect(result.status).toBe(0);
    expect(existsSync(settingsPath)).toBe(true);
    const settings = readSettings();
    expect(Object.keys(settings)).toEqual(["hooks"]);
    expect(speechCommands(settings)).toHaveLength(1);
    expect(allStopCommands(settings)).toHaveLength(1);
  });

  it("refuses to write over malformed JSON", () => {
    const malformed = '{ "hooks": { "Stop": [ oops\n';
    writeFileSync(settingsPath, malformed);
    const before = readFileSync(settingsPath);

    const result = run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(settingsPath);
    // Byte-identical afterwards: it must not have written anything at all.
    expect(readFileSync(settingsPath).equals(before)).toBe(true);
  });

  it("registers Stop only", () => {
    const result = run();

    expect(result.status).toBe(0);
    const settings = readSettings();
    expect(Object.keys(settings.hooks ?? {})).toEqual(["Stop"]);
    expect(settings.hooks?.SubagentStop).toBeUndefined();
    expect(settings.hooks?.Notification).toBeUndefined();
  });
});
