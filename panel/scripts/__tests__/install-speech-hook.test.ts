import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(TEST_DIR, "..", "install-speech-hook.mjs");

// The installer must register this file; the path is also its identity key.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";
// Resolved the same way the installer resolves it, so the expectations below
// travel with the checkout instead of hard-coding one machine's path.
const HOOK_PATH = resolve(TEST_DIR, "..", "..", "hooks", "speak-response.mjs");

// The second Claude Code registration: the question emitter, hung off
// `PreToolUse` with an `AskUserQuestion` matcher because the turn it speaks for
// is still waiting and so never reaches `Stop`. Its own file path is its own
// identity key, exactly as the response emitter's is. What stops the two from
// pruning each other is that pruning is scoped per event and these sit on
// different ones — the markers sharing no substring is incidental.
const QUESTION_HOOK_MARKER = "panel/hooks/speak-question.mjs";
const QUESTION_HOOK_PATH = resolve(
  TEST_DIR,
  "..",
  "..",
  "hooks",
  "speak-question.mjs",
);
const QUESTION_MATCHER = "AskUserQuestion";

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

/*
 * Windows-shaped hook paths — where the TOML hazard lives. `resolve()` there
 * returns `C:\Users\…`, and `\U` is not one of TOML's defined escapes (`\\`,
 * `\"`, `\n`, `\t`, `\uXXXX`, …), so a path spliced raw into a basic string
 * does not merely fail to register the hook: it leaves the user's whole
 * config.toml unparseable, everything they already had in it included. POSIX
 * `resolve()` never emits a backslash, so a test pinned to this machine's own
 * path passes with the bug as readily as without it.
 *
 * The second path carries quotes as well, which is what pins the *order* of
 * the two replacements: escaping quotes first would double the backslash that
 * quote-escaping had just introduced, closing the string early.
 */
const WINDOWS_HOOK_PATH =
  "C:\\Users\\foo\\panel\\hooks\\speak-response-codex.mjs";
const WINDOWS_HOOK_PATH_WITH_QUOTES =
  'C:\\Users\\foo "bar"\\panel\\hooks\\speak-response-codex.mjs';

/**
 * Runs the installer with `path.resolve()` handing it a Windows-shaped path for
 * the codex emitter — the one thing this box cannot produce by itself. Staging
 * the script under a directory whose *name* holds a backslash is no route
 * either: node's ESM loader refuses outright to load a module whose path
 * contains one. So the lever is a `--import` preload that patches `resolve` on
 * the `path` CJS export object *before* node builds the ESM facade the
 * installer imports from. Nothing in the code under test is touched — the
 * installer's own splicing is what writes the file.
 */
function runWithCodexHookPath(hookPath: string) {
  const stub = join(home, "windows-path-stub.mjs");
  writeFileSync(
    stub,
    `import { createRequire } from "node:module";
const path = createRequire(import.meta.url)("path");
const realResolve = path.resolve;
path.resolve = (...parts) => {
  const resolved = realResolve(...parts);
  return resolved.endsWith("speak-response-codex.mjs")
    ? ${JSON.stringify(hookPath)}
    : resolved;
};
`,
  );
  return spawnSync(
    process.execPath,
    ["--import", pathToFileURL(stub).href, SCRIPT],
    {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    },
  );
}

/**
 * The first interpreter here whose stdlib carries `tomllib` (3.11+), or
 * undefined. This repo has no TOML parser and pulling one in to check six
 * written lines would be the very trade the installer itself refuses; python's
 * is already on the box. `python3` is not assumed new enough — on this machine
 * it is 3.8 with 3.12 sitting beside it.
 */
const TOML_PYTHON = ["python3", "python3.13", "python3.12", "python3.11"].find(
  (bin) =>
    spawnSync(bin, ["-c", "import tomllib"], { encoding: "utf8" }).status === 0,
);

interface CodexToml {
  hooks?: { Stop?: { hooks?: { command?: string }[] }[] };
}

/** Parses a written config.toml — proof it is TOML at all, not merely bytes. */
function parseToml(path: string): CodexToml {
  const parsed = spawnSync(
    TOML_PYTHON as string,
    [
      "-c",
      "import json,sys,tomllib;json.dump(tomllib.load(open(sys.argv[1],'rb')),sys.stdout)",
      path,
    ],
    { encoding: "utf8" },
  );
  expect(parsed.stderr).toBe("");
  expect(parsed.status).toBe(0);
  return JSON.parse(parsed.stdout) as CodexToml;
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

function preToolUseEntries(settings: Settings): HookEntry[] {
  return settings.hooks?.PreToolUse ?? [];
}

/**
 * Every `PreToolUse` entry carrying the question emitter. Matched on the hook
 * *command*, not on the matcher: an `AskUserQuestion` entry someone else wrote
 * is not ours, and the installer must neither count it nor remove it.
 */
function questionEntries(settings: Settings): HookEntry[] {
  return preToolUseEntries(settings).filter((entry) =>
    (entry.hooks ?? []).some((hook) =>
      (hook.command ?? "").includes(QUESTION_HOOK_MARKER),
    ),
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
 * A settings file that already holds `PreToolUse` hooks of its own — including
 * one on the very matcher we register. Both must survive an install untouched
 * and an uninstall untouched; the second is the case that would be lost if the
 * installer keyed its own entry on the matcher rather than on its hook command.
 *
 * Written back as the seed *bytes* by the tests that use it, so an uninstall
 * can be compared against them byte-for-byte.
 */
const EXISTING_WITH_PRETOOLUSE = {
  model: "opus",
  permissions: { allow: ["Bash(ls:*)"] },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "echo other-stop-hook" }] }],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "echo somebody-elses-guard" }],
      },
      {
        matcher: QUESTION_MATCHER,
        hooks: [{ type: "command", command: "echo somebody-elses-question" }],
      },
    ],
    Notification: [{ hooks: [{ type: "command", command: "echo peon-ping" }] }],
  },
};

/**
 * Byte-for-byte what the installer writes over `existingSettings`. Key order —
 * the events the file already had keep their positions and `PreToolUse`, which
 * it did not, lands last — two-space indent, entry position and the trailing
 * newline are all part of the expectation.
 */
const EXPECTED_SETTINGS = `{
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
    ],
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node \\"${QUESTION_HOOK_PATH}\\""
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

/*
 * The retired-registration lever. `CLAUDE_REGISTRATIONS` is both the list
 * install writes and the list uninstall prunes, so an entry *deleted* from it
 * is not removed from anybody's settings — it is orphaned there, still invoked
 * by Claude Code, and failing on every turn once the clone it names is gone.
 * `retired: true` is the way out: pruned, never written. No shipped entry is
 * retired yet, so the only way to exercise the flag is to stage a copy of the
 * installer with one spliced in.
 *
 * The copy is staged under a directory literally named `panel`, so every path
 * the installer resolves for itself still ends in the marker suffixes the real
 * one uses and the live registrations behave exactly as they do in place.
 */
const RETIRED_EVENT = "SubagentStop";
const RETIRED_MARKER = "panel/hooks/speak-retired.mjs";
const RETIRED_COMMAND = "node retired-emitter";

function runWithRetiredRegistration(...args: string[]) {
  const anchor = "const CLAUDE_REGISTRATIONS = [\n";
  const source = readFileSync(SCRIPT, "utf8");
  // Guard against a vacuous pass: a renamed or reshaped constant would
  // otherwise quietly turn this into an ordinary install.
  expect(source).toContain(anchor);
  const stagedDir = join(home, "staged-repo", "panel", "scripts");
  mkdirSync(stagedDir, { recursive: true });
  const staged = join(stagedDir, "install-speech-hook.mjs");
  writeFileSync(
    staged,
    source.replace(
      anchor,
      `${anchor}  { event: ${JSON.stringify(RETIRED_EVENT)}, marker: ${JSON.stringify(
        RETIRED_MARKER,
      )}, command: ${JSON.stringify(RETIRED_COMMAND)}, retired: true },\n`,
    ),
  );
  return spawnSync(process.execPath, [staged, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
}

/** A settings file still carrying the hook a retired registration once wrote. */
function seedRetiredHook() {
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        model: "opus",
        hooks: {
          [RETIRED_EVENT]: [
            {
              hooks: [
                {
                  type: "command",
                  command: `node "/old/clone/${RETIRED_MARKER}"`,
                },
              ],
            },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "echo other-stop-hook" }] },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
}

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

  it("installs both the Stop and the AskUserQuestion PreToolUse entries", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    const result = run();

    expect(result.status).toBe(0);
    const settings = readSettings();
    // The finished-turn emitter, exactly as it has always been registered.
    expect(speechCommands(settings)).toEqual([`node "${HOOK_PATH}"`]);
    // The question emitter, matched so it only fires on AskUserQuestion.
    const ours = questionEntries(settings);
    expect(ours).toHaveLength(1);
    expect(ours[0]).toEqual({
      matcher: QUESTION_MATCHER,
      hooks: [{ type: "command", command: `node "${QUESTION_HOOK_PATH}"` }],
    });
    // Both point into this checkout, not at some other clone's copy.
    expect(QUESTION_HOOK_PATH.startsWith(dirname(dirname(TEST_DIR)))).toBe(true);
  });

  it("installing twice does not duplicate the PreToolUse entry", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    expect(run().status).toBe(0);
    const afterFirst = readFileSync(settingsPath, "utf8");
    expect(run().status).toBe(0);
    expect(run().status).toBe(0);

    const settings = readSettings();
    expect(questionEntries(settings)).toHaveLength(1);
    expect(preToolUseEntries(settings)).toHaveLength(1);
    expect(speechCommands(settings)).toHaveLength(1);
    // Byte-identical: a second run must not append, reorder or reformat.
    expect(readFileSync(settingsPath, "utf8")).toBe(afterFirst);
  });

  it("uninstall removes both and leaves unrelated hooks untouched", () => {
    const seed = `${JSON.stringify(EXISTING_WITH_PRETOOLUSE, null, 2)}\n`;
    writeFileSync(settingsPath, seed);

    expect(run().status).toBe(0);
    const installed = readSettings();
    // Guard against a vacuous pass: both entries really were added …
    expect(speechCommands(installed)).toHaveLength(1);
    expect(questionEntries(installed)).toHaveLength(1);
    // … alongside, not on top of, the entries that were already there —
    // including the foreign one sharing our matcher.
    expect(preToolUseEntries(installed).map((entry) => entry.matcher)).toEqual([
      "Bash",
      QUESTION_MATCHER,
      QUESTION_MATCHER,
    ]);
    expect(preToolUseEntries(installed)[1].hooks).toEqual([
      { type: "command", command: "echo somebody-elses-question" },
    ]);

    expect(run("--uninstall").status).toBe(0);

    const settings = readSettings();
    expect(speechCommands(settings)).toHaveLength(0);
    expect(questionEntries(settings)).toHaveLength(0);
    // Back to exactly the file we started from — every unrelated hook, event
    // and setting, in its original order and formatting.
    expect(readFileSync(settingsPath, "utf8")).toBe(seed);
  });

  it("codex and opencode registrations are unchanged", () => {
    makeRoots([".codex"], [".config", "opencode"]);
    writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);

    expect(run().status).toBe(0);

    // codex gets its one finished-turn block and nothing else.
    const raw = readCodexConfig();
    expect(countCodexBlocks(raw)).toBe(1);
    expect(raw).toContain(CODEX_BLOCK);
    expect(raw).not.toContain(QUESTION_MATCHER);
    expect(raw).not.toContain("PreToolUse");
    expect(raw).not.toContain("speak-question");
    expect(withoutCodexBlock(raw)).toBe(CODEX_SEED_CONFIG);
    // opencode gets its one plugin link and nothing else.
    expect(readdirSync(opencodePluginsDir)).toEqual(["pavilio-speech.ts"]);
    expect(readlinkSync(opencodeLinkPath)).toBe(OPENCODE_PLUGIN_PATH);
  });

  it("never registers a Notification event", () => {
    makeRoots([".codex"], [".config", "opencode"]);

    const result = run();

    expect(result.status).toBe(0);
    const settings = readSettings();
    // The complete set of events this installer writes. `Notification` belongs
    // to peon-ping and `SubagentStop` would fire once per subagent.
    expect(Object.keys(settings.hooks ?? {})).toEqual(["Stop", "PreToolUse"]);
    expect(settings.hooks?.SubagentStop).toBeUndefined();
    expect(settings.hooks?.Notification).toBeUndefined();
    expect(readCodexConfig()).not.toContain("Notification");
    expect(readCodexConfig()).not.toContain("SubagentStop");
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

  it("writes the claude settings file byte-for-byte, formatting and key order included", () => {
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    makeRoots([".codex"], [".config", "opencode"]);

    expect(run().status).toBe(0);

    expect(readFileSync(settingsPath, "utf8")).toBe(EXPECTED_SETTINGS);
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

  it("escapes backslashes and quotes out of the path it splices into TOML", () => {
    makeRoots([".codex"]);

    const result = runWithCodexHookPath(WINDOWS_HOOK_PATH_WITH_QUOTES);

    expect(result.status).toBe(0);
    // Spelled out rather than recomputed with the installer's own replace():
    // the expectation here *is* the exact bytes, and a mirrored expression
    // would agree with the bug as readily as with the fix.
    expect(readCodexConfig()).toContain(
      String.raw`command = "node \"C:\\Users\\foo \"bar\"\\panel\\hooks\\speak-response-codex.mjs\""`,
    );
    // The escaping belongs to the TOML literal and stops there: the report the
    // user reads back shows the path as it actually is on disk.
    expect(result.stdout).toContain(`node "${WINDOWS_HOOK_PATH_WITH_QUOTES}"`);
  });

  it.skipIf(!TOML_PYTHON)(
    "leaves config.toml parseable after a Windows-shaped install",
    () => {
      makeRoots([".codex"]);

      for (const hookPath of [
        WINDOWS_HOOK_PATH,
        WINDOWS_HOOK_PATH_WITH_QUOTES,
      ]) {
        writeFileSync(codexConfigPath, CODEX_SEED_CONFIG);

        expect(runWithCodexHookPath(hookPath).status).toBe(0);

        // Unescaped, this file does not merely fail to register a hook: it
        // stops being TOML, taking the user's model, projects and MCP servers
        // down with it, and codex says nothing about why.
        const commands = (parseToml(codexConfigPath).hooks?.Stop ?? [])
          .flatMap((entry) => entry.hooks ?? [])
          .map((hook) => hook.command ?? "");
        // Round-trips to the path itself, so the escaping is correct and not
        // merely parseable — a doubled backslash left behind shows up here.
        expect(commands).toContain(`node "${hookPath}"`);
        // And peon-ping's own block came back through the same parse.
        expect(commands).toContain(
          "bash /root/.claude/hooks/peon-ping/adapters/codex.sh",
        );
      }
    },
  );

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

  // --- what the identity test is for ---------------------------------------

  it("replaces stale entries left by a clone that has since moved", () => {
    // The state a `git worktree remove`, a `mv`, or a re-clone leaves behind:
    // both registrations still in the file, both naming a path that is not this
    // checkout. `isOurs` matches on the marker *substring* precisely so these
    // are still ours — an exact match would leave them in place and the
    // install would stack a second copy of each beside them, so every finished
    // turn and every question would be spoken twice, one of them by a command
    // that no longer exists.
    const staleStop = 'node "/old/clone/panel/hooks/speak-response.mjs"';
    const staleQuestion = 'node "/old/clone/panel/hooks/speak-question.mjs"';
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          model: "opus",
          hooks: {
            Stop: [
              {
                hooks: [{ type: "command", command: "echo other-stop-hook" }],
              },
              { hooks: [{ type: "command", command: staleStop }] },
            ],
            PreToolUse: [
              {
                matcher: QUESTION_MATCHER,
                hooks: [{ type: "command", command: staleQuestion }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(run().status).toBe(0);

    const settings = readSettings();
    // Exactly one of each, at this checkout's paths — replaced, not stacked.
    expect(speechCommands(settings)).toEqual([`node "${HOOK_PATH}"`]);
    expect(questionEntries(settings)).toEqual([
      {
        matcher: QUESTION_MATCHER,
        hooks: [{ type: "command", command: `node "${QUESTION_HOOK_PATH}"` }],
      },
    ]);
    expect(preToolUseEntries(settings)).toHaveLength(1);
    // Nothing anywhere in the file still points at the old checkout.
    expect(JSON.stringify(settings)).not.toContain("/old/clone");
    // Guard against a vacuous pass: the unrelated hook was never at risk.
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");
  });

  it("uninstall keeps a foreign command sharing one of our entries", () => {
    // Hand-merged settings: somebody put their own command into the same
    // `hooks` array as ours rather than adding an entry of their own. Removing
    // the whole entry would take their hook with it, so uninstall has to take
    // out the one command and leave the wrapper — matcher included — standing.
    const seed = {
      model: "opus",
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo neighbour-in-our-entry" },
              { type: "command", command: `node "${HOOK_PATH}"` },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: QUESTION_MATCHER,
            hooks: [
              { type: "command", command: `node "${QUESTION_HOOK_PATH}"` },
              { type: "command", command: "echo neighbour-question-guard" },
            ],
          },
        ],
      },
    };
    writeFileSync(settingsPath, `${JSON.stringify(seed, null, 2)}\n`);

    expect(run("--uninstall").status).toBe(0);

    const settings = readSettings();
    // Ours is gone …
    expect(speechCommands(settings)).toHaveLength(0);
    expect(questionEntries(settings)).toHaveLength(0);
    // … and the entries that carried it survive, holding only the neighbour.
    expect(stopEntries(settings)).toEqual([
      { hooks: [{ type: "command", command: "echo neighbour-in-our-entry" }] },
    ]);
    expect(preToolUseEntries(settings)).toEqual([
      {
        matcher: QUESTION_MATCHER,
        hooks: [
          { type: "command", command: "echo neighbour-question-guard" },
        ],
      },
    ]);
    expect(settings.model).toBe("opus");
  });

  it("uninstall deletes the PreToolUse event install had to invent", () => {
    // The ordinary upgrade shape: a settings file from before the question
    // emitter existed, so `PreToolUse` is an event the installer creates. An
    // uninstall that emptied it instead of deleting it would leave a
    // `"PreToolUse": []` behind — harmless to Claude Code, but it means
    // uninstall no longer returns the file to what it was.
    const seed = `${JSON.stringify(existingSettings, null, 2)}\n`;
    expect(existingSettings.hooks).not.toHaveProperty("PreToolUse");
    writeFileSync(settingsPath, seed);

    expect(run().status).toBe(0);
    // Guard against a vacuous pass: install really did invent the event.
    expect(preToolUseEntries(readSettings())).toHaveLength(1);

    expect(run("--uninstall").status).toBe(0);

    expect(readSettings().hooks).not.toHaveProperty("PreToolUse");
    // Byte-identical to the file we started from.
    expect(readFileSync(settingsPath, "utf8")).toBe(seed);
  });

  it("prunes a retired registration without ever installing it", () => {
    seedRetiredHook();

    const result = runWithRetiredRegistration();

    expect(result.status).toBe(0);
    const settings = readSettings();
    // Pruned: the hook a previous version wrote is gone, and so is the event
    // it was the only occupant of.
    expect(settings.hooks).not.toHaveProperty(RETIRED_EVENT);
    expect(JSON.stringify(settings)).not.toContain("speak-retired");
    // Never written: not re-added under any event, and absent from the report
    // that tells the user what was registered.
    expect(JSON.stringify(settings)).not.toContain(RETIRED_COMMAND);
    expect(result.stdout).not.toContain(RETIRED_COMMAND);
    // Guard against a vacuous pass: the live registrations still installed.
    expect(speechCommands(settings)).toHaveLength(1);
    expect(questionEntries(settings)).toHaveLength(1);
    expect(allStopCommands(settings)).toContain("echo other-stop-hook");

    // And uninstall prunes it from an untouched file just the same — which is
    // the whole point of keeping a retired entry in the list rather than
    // deleting it.
    seedRetiredHook();

    expect(runWithRetiredRegistration("--uninstall").status).toBe(0);

    const afterUninstall = readSettings();
    expect(afterUninstall.hooks).not.toHaveProperty(RETIRED_EVENT);
    expect(JSON.stringify(afterUninstall)).not.toContain("speak-retired");
    expect(allStopCommands(afterUninstall)).toEqual(["echo other-stop-hook"]);
  });
});
