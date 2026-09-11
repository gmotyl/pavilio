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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(TEST_DIR, "..", "install-speech-hook.mjs");

// The installer must register this file; the path is also its identity key.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";
// Resolved the same way the installer resolves it, so the expectations below
// travel with the checkout instead of hard-coding one machine's path.
const HOOK_PATH = resolve(TEST_DIR, "..", "..", "hooks", "speak-response.mjs");

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

/**
 * The per-agent report: stdout lines shaped `<agent>: <what happened>`, keyed by
 * agent. Continuation lines (the indented hook command) are deliberately not
 * matched, so each agent contributes exactly one entry.
 */
function reportLines(stdout: string): Record<string, string> {
  const lines: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const match = /^(claude|codex|opencode): (.*)$/.exec(line);
    if (match) lines[match[1]] = match[2];
  }
  return lines;
}

function makeRoots(...roots: string[][]) {
  for (const parts of roots) mkdirSync(join(home, ...parts), { recursive: true });
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

/**
 * Byte-for-byte what the single-agent installer (HEAD before the multi-agent
 * shell) wrote when run once over `existingSettings` — captured from an actual
 * run of that script. Key order, two-space indent, entry position and the
 * trailing newline are all part of the expectation.
 */
const SINGLE_AGENT_SETTINGS = `{
  "model": "opus",
  "permissions": {
    "allow": [
      "Bash(ls:*)"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo other-stop-hook"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \\"${HOOK_PATH}\\""
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo peon-ping"
          }
        ]
      }
    ]
  }
}
`;

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
    // The agent root is what detection keys on, so it stays; what is absent
    // here is the settings file itself, which the installer must create.
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

  // --- the multi-agent shell ------------------------------------------------

  it("installs for every agent whose config root exists", () => {
    makeRoots([".codex"], [".config", "opencode"]);

    const result = run();

    expect(result.status).toBe(0);
    const lines = reportLines(result.stdout);
    // One line per agent, and none of them skipped.
    expect(Object.keys(lines).sort()).toEqual(["claude", "codex", "opencode"]);
    expect(lines.claude).not.toMatch(/skipped/i);
    expect(lines.codex).not.toMatch(/skipped/i);
    expect(lines.opencode).not.toMatch(/skipped/i);
    expect(speechCommands(readSettings())).toHaveLength(1);
  });

  it("skips and reports an agent whose root is absent", () => {
    makeRoots([".codex"]);
    // ~/.config/opencode deliberately left absent.

    const result = run();

    expect(result.status).toBe(0);
    const lines = reportLines(result.stdout);
    expect(lines.opencode).toMatch(/skipped/i);
    expect(lines.claude).not.toMatch(/skipped/i);
    expect(lines.codex).not.toMatch(/skipped/i);
    // The absent agent does not stop the present ones from installing.
    expect(speechCommands(readSettings())).toHaveLength(1);
  });

  it("leaves the claude settings file byte-identical to the single-agent installer", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    makeRoots([".codex"], [".config", "opencode"]);

    expect(run().status).toBe(0);

    expect(readFileSync(settingsPath, "utf8")).toBe(SINGLE_AGENT_SETTINGS);
  });

  it("uninstalls every agent", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    makeRoots([".codex"], [".config", "opencode"]);
    expect(run().status).toBe(0);

    const result = run("--uninstall");

    expect(result.status).toBe(0);
    const lines = reportLines(result.stdout);
    expect(Object.keys(lines).sort()).toEqual(["claude", "codex", "opencode"]);
    const settings = readSettings();
    expect(speechCommands(settings)).toHaveLength(0);
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");
  });

  it("reports a failing agent without aborting the others", () => {
    // Malformed JSON is the one way to make the claude target fail outright.
    writeFileSync(settingsPath, '{ "hooks": { "Stop": [ oops\n');
    makeRoots([".codex"], [".config", "opencode"]);

    const result = run();

    // The failure is reported, named, and reflected in the exit status …
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("claude");
    expect(result.stderr).toContain(settingsPath);
    // … while the other agents still got their turn.
    const lines = reportLines(result.stdout);
    expect(lines.codex).toBeDefined();
    expect(lines.opencode).toBeDefined();
  });
});
