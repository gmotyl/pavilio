import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  existsSync,
  statSync,
  symlinkSync,
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

// codex registers its emitter as a marker-delimited block in config.toml rather
// than as a parsed edit, so the expectation here is the literal block text —
// including the TOML-escaped quotes around the absolute path.
const CODEX_HOOK_PATH = resolve(
  TEST_DIR,
  "..",
  "..",
  "hooks",
  "speak-response-codex.mjs",
);
const CODEX_BLOCK = `# pavilio-speech begin
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "node \\"${CODEX_HOOK_PATH}\\""
timeout = 30
# pavilio-speech end
`;

// opencode is registered as a symlink rather than as an edit to a config file:
// `~/.config/opencode/plugins/pavilio-speech.ts` points back at the repo file, so
// a `pnpm pull` cannot leave a stale copy behind. The link target is also the
// identity key — any link resolving to a path ending in this suffix is ours.
const OPENCODE_PLUGIN_MARKER = "panel/hooks/speak-response-opencode.ts";
const OPENCODE_PLUGIN_PATH = resolve(
  TEST_DIR,
  "..",
  "..",
  "hooks",
  "speak-response-opencode.ts",
);

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
let codexConfigPath: string;
let opencodeRoot: string;
let opencodePluginsDir: string;
let opencodeLinkPath: string;

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

/** Every `<agent>: …` report line for one agent — there must only ever be one. */
function agentLines(stdout: string, agent: string): string[] {
  return stdout.split("\n").filter((line) => line.startsWith(`${agent}: `));
}

function makeRoots(...roots: string[][]) {
  for (const parts of roots) mkdirSync(join(home, ...parts), { recursive: true });
}

/**
 * lstat, not existsSync: a *dangling* symlink is still very much present at the
 * path, and the installer has to see it there in order to replace it.
 */
function linkExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function readCodexConfig(): string {
  return readFileSync(codexConfigPath, "utf8");
}

function countCodexBlocks(raw: string): number {
  return raw.split("\n").filter((line) => line === "# pavilio-speech begin")
    .length;
}

/**
 * Everything *outside* the managed block — the bytes the installer promises to
 * copy through untouched. Cuts the marker lines and the one blank line the
 * installer inserts ahead of an appended block, which is the exact inverse of
 * how the block is written.
 */
function withoutCodexBlock(raw: string): string {
  const lines = raw.split("\n");
  const begin = lines.indexOf("# pavilio-speech begin");
  const end = lines.indexOf("# pavilio-speech end");
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const head = lines.slice(0, begin);
  if (head[head.length - 1] === "") head.pop();
  return head.concat(lines.slice(end + 1)).join("\n");
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

/**
 * Shaped like a real `~/.codex/config.toml`: bare scalars, dotted-key tables,
 * quoted-key tables, the `[hooks.state]` trust ledger, and peon-ping's own
 * marker-delimited block with its own `[[hooks.Stop]]` in it. Blank lines and
 * comments are part of the fixture — they are what a TOML round-trip would eat.
 */
const CODEX_SEED_CONFIG = `model = "gpt-5.6-luna"
approvals_reviewer = "auto_review"

[projects."/root/git/prv/projects"]
trust_level = "trusted"

[mcp_servers.todoist]
command = "npx"

[hooks.state]

[hooks.state."/root/.codex/config.toml:stop:0:0"]
trusted_hash = "sha256:efd1150768d3d7da868368096da7ffd6ccd6d4158710bda86058b5edf3a4a0db"

# peon-ping Codex hooks begin
[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "bash /root/.claude/hooks/peon-ping/adapters/codex.sh"
timeout = 30
# peon-ping Codex hooks end
`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pavilio-install-speech-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  settingsPath = join(home, ".claude", "settings.json");
  codexConfigPath = join(home, ".codex", "config.toml");
  opencodeRoot = join(home, ".config", "opencode");
  opencodePluginsDir = join(opencodeRoot, "plugins");
  opencodeLinkPath = join(opencodePluginsDir, "pavilio-speech.ts");
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

  // --- the codex target -----------------------------------------------------

  it("appends the managed block to an existing config", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);

    const result = run();

    expect(result.status).toBe(0);
    const raw = readCodexConfig();
    expect(raw).toContain(CODEX_BLOCK);
    // Appended, so everything that was there stays where it was …
    expect(raw.endsWith(CODEX_BLOCK)).toBe(true);
    // … byte for byte.
    expect(withoutCodexBlock(raw)).toBe(CODEX_SEED_CONFIG);
  });

  it("replaces the block instead of appending a second one", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    expect(run().status).toBe(0);
    const afterFirst = readCodexConfig();

    expect(run().status).toBe(0);
    expect(run().status).toBe(0);

    expect(countCodexBlocks(readCodexConfig())).toBe(1);
    // Byte-identical: a re-run refreshes the block in place, it does not stack.
    expect(readCodexConfig()).toBe(afterFirst);
  });

  it("preserves other hooks and unrelated tables", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    expect(run().status).toBe(0);

    // The user then adds a table of their own *after* our block. A later
    // install must rewrite the block where it sits, not swallow what follows.
    const trailing = `
[mcp_servers.added_later]
command = "npx"
`;
    writeFileSync(codexConfigPath, readCodexConfig() + trailing);

    expect(run().status).toBe(0);

    const raw = readCodexConfig();
    expect(countCodexBlocks(raw)).toBe(1);
    expect(raw).toContain(CODEX_BLOCK);
    // Everything outside the markers — before and after — is untouched.
    expect(withoutCodexBlock(raw)).toBe(CODEX_SEED_CONFIG + trailing);
    expect(raw).toContain("# peon-ping Codex hooks begin");
    expect(raw).toContain(
      'command = "bash /root/.claude/hooks/peon-ping/adapters/codex.sh"',
    );
    expect(raw).toContain('[projects."/root/git/prv/projects"]');
    expect(raw).toContain("[mcp_servers.added_later]");
  });

  it("removes the block and its markers on uninstall", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    expect(run().status).toBe(0);
    // Guard against a vacuous pass: there has to be a block to remove.
    expect(readCodexConfig()).toContain(CODEX_BLOCK);

    const result = run("--uninstall");

    expect(result.status).toBe(0);
    const raw = readCodexConfig();
    expect(raw).not.toContain("pavilio-speech");
    expect(raw).not.toContain("speak-response-codex.mjs");
    // Back to exactly the file we started from, blank separator included.
    expect(raw).toBe(CODEX_SEED_CONFIG);
  });

  it("creates the config file when absent", () => {
    makeRoots([".codex"]);
    expect(existsSync(codexConfigPath)).toBe(false);

    const result = run();

    expect(result.status).toBe(0);
    expect(existsSync(codexConfigPath)).toBe(true);
    // Nothing but the block — no invented scaffolding around it.
    expect(readCodexConfig()).toBe(CODEX_BLOCK);
  });

  it("prints the one-time trust note", () => {
    makeRoots([".codex"]);

    const result = run();

    expect(result.status).toBe(0);
    expect(reportLines(result.stdout).codex).toBeDefined();
    // The note is a continuation of codex's single report line, not a second
    // `codex:` line — the per-agent report stays one line per agent.
    expect(agentLines(result.stdout, "codex")).toHaveLength(1);
    expect(result.stdout).toMatch(/^ +.*trust/im);
  });

  it("never writes a trusted_hash", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    const hashesBefore = (CODEX_SEED_CONFIG.match(/trusted_hash/g) ?? []).length;
    const statesBefore = (CODEX_SEED_CONFIG.match(/\[hooks\.state/g) ?? [])
      .length;

    expect(run().status).toBe(0);

    const raw = readCodexConfig();
    // Guard against a vacuous pass: the hook did get registered …
    expect(raw).toContain(CODEX_BLOCK);
    // … codex's trust gate exists to make the user read a new hook's command.
    // Forging its ledger entry would defeat it, so the installer adds none.
    expect((raw.match(/trusted_hash/g) ?? []).length).toBe(hashesBefore);
    expect((raw.match(/\[hooks\.state/g) ?? []).length).toBe(statesBefore);
    expect(CODEX_BLOCK).not.toMatch(/trusted_hash|hooks\.state/);
  });
  // --- what the file already held ------------------------------------------

  it("preserves the codex config file permissions", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    // A real ~/.codex/config.toml is 0600: it carries MCP server definitions
    // with plaintext tokens in them. A write that lands on a fresh inode would
    // hand those to every account on the machine.
    chmodSync(codexConfigPath, 0o600);

    expect(run().status).toBe(0);

    // Guard against a vacuous pass: it did rewrite the file.
    expect(readCodexConfig()).toContain(CODEX_BLOCK);
    expect(statSync(codexConfigPath).mode & 0o777).toBe(0o600);

    // Uninstall rewrites the same file and must not loosen it either.
    expect(run("--uninstall").status).toBe(0);
    expect(statSync(codexConfigPath).mode & 0o777).toBe(0o600);
  });

  it("preserves the claude settings file permissions", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    // 0600 is not the default for this file, but a user who tightened it has
    // to stay tightened — the writer is the same temp-file-plus-rename dance.
    chmodSync(settingsPath, 0o600);

    expect(run().status).toBe(0);

    expect(speechCommands(readSettings())).toHaveLength(1);
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);

    expect(run("--uninstall").status).toBe(0);
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
  });

  it("creates absent config files readable only by their owner", () => {
    makeRoots([".codex"]);
    expect(existsSync(settingsPath)).toBe(false);
    expect(existsSync(codexConfigPath)).toBe(false);

    expect(run().status).toBe(0);

    // Nothing to inherit, so the installer picks the conservative mode: these
    // files grow credentials over time and only their owner ever reads them.
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
    expect(statSync(codexConfigPath).mode & 0o777).toBe(0o600);
  });

  it("refuses to write when a stray begin marker sits above the block", () => {
    makeRoots([".codex"]);
    // Two begin markers, one end. Taking the first begin and the first end
    // would delete everything between them — the user's keys included.
    const strayed = `${CODEX_SEED_CONFIG}# pavilio-speech begin
keep_me = "user content"

${CODEX_BLOCK}[mcp_servers.tail]
command = "npx"
`;
    writeFileSync(codexConfigPath, strayed);

    const result = run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(codexConfigPath);
    // Byte-identical afterwards: damaged markers are reported, never guessed at.
    expect(readCodexConfig()).toBe(strayed);
  });

  it("collapses a pre-existing pair of duplicate blocks", () => {
    makeRoots([".codex"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);
    expect(run().status).toBe(0);
    // An older installer stacked a second copy of the block. Two registrations
    // means the answer is spoken twice, so install has to converge on one.
    writeFileSync(codexConfigPath, `${readCodexConfig()}\n${CODEX_BLOCK}`);
    expect(countCodexBlocks(readCodexConfig())).toBe(2);

    expect(run().status).toBe(0);

    const raw = readCodexConfig();
    expect(countCodexBlocks(raw)).toBe(1);
    expect(withoutCodexBlock(raw)).toBe(CODEX_SEED_CONFIG);
    // And a single uninstall takes the lot back out, not one copy per run.
    expect(run("--uninstall").status).toBe(0);
    expect(readCodexConfig()).toBe(CODEX_SEED_CONFIG);
  });

  // --- the opencode target --------------------------------------------------

  it("symlinks the plugin into the opencode plugins directory", () => {
    makeRoots([".config", "opencode"]);

    const result = run();

    expect(result.status).toBe(0);
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(true);
    // Pointed at the repo file itself, not at a copy of it: a copy would go
    // stale on the next `pnpm pull` without ever saying so.
    expect(readlinkSync(opencodeLinkPath)).toBe(OPENCODE_PLUGIN_PATH);
    expect(realpathSync(opencodeLinkPath)).toBe(
      realpathSync(OPENCODE_PLUGIN_PATH),
    );
    expect(reportLines(result.stdout).opencode).not.toMatch(/skipped/i);
  });

  it("creates the plugins directory when absent", () => {
    makeRoots([".config", "opencode"]);
    // Guard against a vacuous pass: the directory must really be missing.
    expect(existsSync(opencodePluginsDir)).toBe(false);

    const result = run();

    expect(result.status).toBe(0);
    expect(statSync(opencodePluginsDir).isDirectory()).toBe(true);
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(true);
  });

  it("creates the plugins directory with the opencode root's own permissions", () => {
    makeRoots([".config", "opencode"]);
    // A directory carries no content of its own, so there is nothing to be
    // conservative *about*; what it should match is the tree it is being added
    // to. A user who tightened ~/.config/opencode gets a tightened plugins/ …
    chmodSync(opencodeRoot, 0o700);
    expect(existsSync(opencodePluginsDir)).toBe(false);

    expect(run().status).toBe(0);

    // Guard against a vacuous pass: it did create the link in there.
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(true);
    expect(statSync(opencodePluginsDir).mode & 0o777).toBe(0o700);

    // … and a default one gets the default, so the mode is inherited rather
    // than hard-coded.
    rmSync(opencodePluginsDir, { recursive: true, force: true });
    chmodSync(opencodeRoot, 0o755);

    expect(run().status).toBe(0);

    expect(statSync(opencodePluginsDir).mode & 0o777).toBe(0o755);
  });

  it("is a no-op when the link already points here", () => {
    makeRoots([".config", "opencode"]);
    expect(run().status).toBe(0);
    const before = lstatSync(opencodeLinkPath);

    const result = run();

    expect(result.status).toBe(0);
    expect(reportLines(result.stdout).opencode).toMatch(/already/i);
    // Same inode: it was left where it was, not relinked through a rename.
    expect(lstatSync(opencodeLinkPath).ino).toBe(before.ino);
    expect(readlinkSync(opencodeLinkPath)).toBe(OPENCODE_PLUGIN_PATH);
  });

  it("replaces a dangling link that is ours", () => {
    makeRoots([".config", "opencode"]);
    mkdirSync(opencodePluginsDir, { recursive: true });
    // Another pavilio checkout that has since been deleted — the exact state a
    // `git worktree remove` leaves behind. The suffix is what makes it ours.
    const stale = join(
      home,
      "another-pavilio",
      "panel",
      "hooks",
      "speak-response-opencode.ts",
    );
    expect(stale.endsWith(OPENCODE_PLUGIN_MARKER)).toBe(true);
    symlinkSync(stale, opencodeLinkPath);
    // Guard against a vacuous pass: the link is there, and it dangles.
    expect(linkExists(opencodeLinkPath)).toBe(true);
    expect(existsSync(opencodeLinkPath)).toBe(false);

    const result = run();

    expect(result.status).toBe(0);
    expect(readlinkSync(opencodeLinkPath)).toBe(OPENCODE_PLUGIN_PATH);
    expect(existsSync(opencodeLinkPath)).toBe(true);
  });

  it("refuses to clobber a real file and reports it", () => {
    makeRoots([".config", "opencode"], [".codex"]);
    mkdirSync(opencodePluginsDir, { recursive: true });
    const foreign = "// someone else's plugin\n";
    writeFileSync(opencodeLinkPath, foreign);

    const result = run();

    // Reported, not thrown: the exit status still lets the other agents install.
    expect(result.status).toBe(0);
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(opencodeLinkPath, "utf8")).toBe(foreign);
    expect(reportLines(result.stdout).opencode).toMatch(/left .* alone/i);
    // Guard against a vacuous pass: the other agents really did get their turn.
    expect(speechCommands(readSettings())).toHaveLength(1);
    expect(readCodexConfig()).toContain(CODEX_BLOCK);

    // A symlink owned by something else is equally off-limits — it is the link
    // *target* that decides ownership, not the fact that it is a link.
    rmSync(opencodeLinkPath);
    const otherPlugin = join(home, "somewhere-else.ts");
    writeFileSync(otherPlugin, foreign);
    symlinkSync(otherPlugin, opencodeLinkPath);

    const second = run();

    expect(second.status).toBe(0);
    expect(readlinkSync(opencodeLinkPath)).toBe(otherPlugin);
    expect(reportLines(second.stdout).opencode).toMatch(/left .* alone/i);
  });

  it("removes only a link it owns on uninstall", () => {
    makeRoots([".config", "opencode"]);
    expect(run().status).toBe(0);
    // Guard against a vacuous pass: there has to be a link to remove.
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(true);

    expect(run("--uninstall").status).toBe(0);

    expect(linkExists(opencodeLinkPath)).toBe(false);
    // The directory itself is opencode's, not ours to delete.
    expect(existsSync(opencodePluginsDir)).toBe(true);

    // A foreign file at the same path is left exactly where it is.
    const foreign = "// someone else's plugin\n";
    writeFileSync(opencodeLinkPath, foreign);

    const result = run("--uninstall");

    expect(result.status).toBe(0);
    expect(readFileSync(opencodeLinkPath, "utf8")).toBe(foreign);
    expect(reportLines(result.stdout).opencode).toMatch(/left .* alone/i);
  });

  it("leaves an unrelated plugin file alone", () => {
    makeRoots([".config", "opencode"]);
    mkdirSync(opencodePluginsDir, { recursive: true });
    const neighbour = join(opencodePluginsDir, "peon-ping.ts");
    const body = "export const PeonPing = async () => ({});\n";
    writeFileSync(neighbour, body);

    expect(run().status).toBe(0);

    // Guard against a vacuous pass: the installer did act on this directory.
    expect(lstatSync(opencodeLinkPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(neighbour, "utf8")).toBe(body);

    expect(run("--uninstall").status).toBe(0);

    expect(linkExists(opencodeLinkPath)).toBe(false);
    expect(readFileSync(neighbour, "utf8")).toBe(body);
  });
});
