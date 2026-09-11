#!/usr/bin/env node
/*
 * Idempotent installer for the agent-response-speech emitters.
 *
 * One command, one pass per agent. Each supported agent is a *target*: a name,
 * the configuration root that proves the agent is installed at all, and an
 * install/uninstall pair. The top-level flow below walks the targets, skips the
 * ones whose root is absent, and prints exactly one line per agent saying what
 * happened. `--uninstall` is symmetric.
 *
 * Why per agent rather than per settings file: each half is independently
 * idempotent, so a partial install (claude today, codex installed next month)
 * converges on a re-run instead of conflicting. And one agent's failure is
 * contained — it is reported and the walk continues, so a broken ~/.claude
 * cannot stop codex and opencode from being registered.
 *
 * Registers each agent's finished-turn event only: Claude Code's `SubagentStop`
 * would fire once per subagent (a dozen times during an execute-plan run) and
 * `Notification` belongs to peon-ping.
 *
 * Run from the repo root as `pnpm install:speech` (add `--uninstall` to remove).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// HOME first so a test (or a scripted install into another account) can redirect
// the whole operation; homedir() is the fallback for platforms without HOME.
const home = process.env.HOME || homedir();

/**
 * A target failure that the walk reports and survives. Thrown instead of
 * exiting: exiting here would take the remaining agents down with it.
 */
class InstallError extends Error {}

function fail(message) {
  throw new InstallError(message);
}

/* ────────────────────────────── claude ────────────────────────────────────
 * Merges exactly one entry into ~/.claude/settings.json and removes exactly
 * that entry again on uninstall. Everything else in the file — other hooks,
 * other events, unrelated settings — is read, kept, and written back untouched.
 *
 * These five functions are the shipped single-agent installer, unchanged in
 * behaviour; only `fail()` differs, and only in that it now throws for the walk
 * to report rather than exiting the process outright.
 * ────────────────────────────────────────────────────────────────────────── */

const HOOK_EVENT = "Stop";
// Identity key: any Stop command referencing this file is ours, whatever the
// absolute prefix. Survives the workspace being moved or cloned elsewhere.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";

// The hook is registered, not validated — a settings entry may legitimately
// point at a path that does not exist yet.
const hookPath = resolve(scriptDir, "..", "hooks", "speak-response.mjs");
const hookCommand = `node "${hookPath}"`;

const claudeRoot = join(home, ".claude");
const settingsPath = join(claudeRoot, "settings.json");

function readSettings() {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(
      `${settingsPath} is not valid JSON (${err.message}). Nothing was written — fix the file and run again.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(
      `${settingsPath} does not hold a JSON object. Nothing was written — fix the file and run again.`,
    );
  }
  return parsed;
}

function isOurs(hook) {
  return (
    hook !== null &&
    typeof hook === "object" &&
    typeof hook.command === "string" &&
    hook.command.includes(HOOK_MARKER)
  );
}

/** Every Stop entry except ours, with our command pruned out of shared entries. */
function withoutOurHook(settings) {
  const hooks = { ...(settings.hooks ?? {}) };
  const stop = Array.isArray(hooks[HOOK_EVENT]) ? hooks[HOOK_EVENT] : [];
  const kept = [];
  for (const entry of stop) {
    if (entry === null || typeof entry !== "object" || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const remaining = entry.hooks.filter((hook) => !isOurs(hook));
    if (remaining.length === entry.hooks.length) kept.push(entry);
    else if (remaining.length > 0) kept.push({ ...entry, hooks: remaining });
    // An entry left with no commands was the wrapper we added; drop it.
  }

  if (kept.length > 0) hooks[HOOK_EVENT] = kept;
  else delete hooks[HOOK_EVENT];

  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function withOurHook(settings) {
  // Strip first, then append: a re-run refreshes the command in place instead of
  // stacking a second entry, and any duplicate from an earlier version collapses.
  const base = withoutOurHook(settings);
  const hooks = { ...(base.hooks ?? {}) };
  const stop = Array.isArray(hooks[HOOK_EVENT]) ? [...hooks[HOOK_EVENT]] : [];
  stop.push({ hooks: [{ type: "command", command: hookCommand }] });
  hooks[HOOK_EVENT] = stop;
  return { ...base, hooks };
}

/** Temp file + rename, so an interrupted run cannot truncate a real settings file. */
function writeSettings(settings) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.install-speech-hook.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tmpPath, settingsPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Nothing useful to do; the real error is reported below.
      }
    }
    fail(`could not write ${settingsPath} (${err.message}).`);
  }
}

const claudeTarget = {
  name: "claude",
  root: claudeRoot,
  install() {
    writeSettings(withOurHook(readSettings()));
    return `Registered the speech ${HOOK_EVENT} hook in ${settingsPath}\n  ${hookCommand}`;
  },
  uninstall() {
    // No settings file means no registration to strip — and writing one here
    // would create a file the user never had.
    if (!existsSync(settingsPath)) {
      return `Nothing to remove — ${settingsPath} does not exist.`;
    }
    writeSettings(withoutOurHook(readSettings()));
    return `Removed the speech ${HOOK_EVENT} hook from ${settingsPath}`;
  },
};

/* ────────────────────────────── codex ──────────────────────────────────────
 * Manages a marker-delimited block in ~/.codex/config.toml: append it if
 * absent, replace it wholesale if present, delete it on uninstall. Everything
 * outside the markers is copied through byte-for-byte.
 *
 * Why not parse the TOML: this repo has no TOML parser, and adding one to
 * parse-and-reserialise a user's config is a bad trade — it would lose comments
 * and blank lines across the *whole* file to rewrite six lines of it. A marker
 * block touches only what it owns. peon-ping already coexists in this same file
 * exactly this way, so the approach is proven in place.
 *
 * What is deliberately NOT written: anything under `[hooks.state]`. codex
 * records a `trusted_hash` there per hook and asks the user to trust a newly
 * registered command once. That gate exists so a human reads the command before
 * it runs; synthesising the hash would defeat it, and the hashing algorithm is
 * undocumented and unpinned besides. The installer registers the hook and says
 * the trust prompt is coming.
 * ────────────────────────────────────────────────────────────────────────── */

const CODEX_BEGIN = "# pavilio-speech begin";
const CODEX_END = "# pavilio-speech end";

const codexRoot = join(home, ".codex");
const codexConfigPath = join(codexRoot, "config.toml");

const codexHookPath = resolve(scriptDir, "..", "hooks", "speak-response-codex.mjs");
// TOML basic string: the inner quotes around the path are escaped, so a path
// containing spaces still reaches the shell as one argument.
const codexHookCommand = `node "${codexHookPath}"`;

const codexBlockLines = [
  CODEX_BEGIN,
  "[[hooks.Stop]]",
  "",
  "[[hooks.Stop.hooks]]",
  'type = "command"',
  `command = "node \\"${codexHookPath}\\""`,
  "timeout = 30",
  CODEX_END,
];

/**
 * Line indices of our block, or null when it is not there. `trimEnd()` tolerates
 * a stray carriage return; an opening marker with no closing one is a damaged
 * file we refuse to guess at rather than silently swallow the rest.
 */
function findCodexBlock(lines) {
  const isMarker = (line, marker) => line.trimEnd() === marker;
  const begin = lines.findIndex((line) => isMarker(line, CODEX_BEGIN));
  if (begin === -1) return null;
  const end = lines.findIndex((line, i) => i > begin && isMarker(line, CODEX_END));
  if (end === -1) {
    fail(
      `${codexConfigPath} has a "${CODEX_BEGIN}" marker with no matching "${CODEX_END}". Nothing was written — fix the file and run again.`,
    );
  }
  return { begin, end };
}

function readCodexConfig() {
  if (!existsSync(codexConfigPath)) return "";
  return readFileSync(codexConfigPath, "utf8");
}

/** Temp file + rename, so an interrupted run cannot truncate a real config. */
function writeCodexConfig(text) {
  mkdirSync(dirname(codexConfigPath), { recursive: true });
  const tmpPath = `${codexConfigPath}.install-speech-hook.tmp`;
  try {
    writeFileSync(tmpPath, text, "utf8");
    renameSync(tmpPath, codexConfigPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Nothing useful to do; the real error is reported below.
      }
    }
    fail(`could not write ${codexConfigPath} (${err.message}).`);
  }
}

const codexTarget = {
  name: "codex",
  root: codexRoot,
  install() {
    const raw = readCodexConfig();
    // An absent or blank file becomes the block and nothing else — no invented
    // scaffolding around it.
    if (raw.trim() === "") {
      writeCodexConfig(`${codexBlockLines.join("\n")}\n`);
    } else {
      const lines = raw.split("\n");
      const found = findCodexBlock(lines);
      if (found) {
        // In place: whatever precedes and follows the block keeps its position.
        const next = [
          ...lines.slice(0, found.begin),
          ...codexBlockLines,
          ...lines.slice(found.end + 1),
        ];
        writeCodexConfig(next.join("\n"));
      } else {
        // Appended after one blank separator line — TOML tables must not run
        // into the previous table's keys, and the blank is what uninstall
        // takes back out again.
        const body = raw.endsWith("\n") ? raw : `${raw}\n`;
        writeCodexConfig(`${body}\n${codexBlockLines.join("\n")}\n`);
      }
    }
    return [
      `Registered the speech ${HOOK_EVENT} hook in ${codexConfigPath}`,
      `  ${codexHookCommand}`,
      "  codex will ask you to trust this hook once, the first time it fires.",
    ].join("\n");
  },
  uninstall() {
    // No config means no registration to strip — and writing one here would
    // create a file the user never had.
    if (!existsSync(codexConfigPath)) {
      return `Nothing to remove — ${codexConfigPath} does not exist.`;
    }
    const raw = readCodexConfig();
    const lines = raw.split("\n");
    const found = findCodexBlock(lines);
    if (!found) {
      return `Nothing to remove — no pavilio-speech block in ${codexConfigPath}`;
    }
    const head = lines.slice(0, found.begin);
    // Take back the one blank separator install put in, and no more: further
    // blank lines above it are the user's.
    if (head.length > 0 && head[head.length - 1] === "") head.pop();
    writeCodexConfig(head.concat(lines.slice(found.end + 1)).join("\n"));
    return `Removed the speech ${HOOK_EVENT} hook from ${codexConfigPath}`;
  },
};

/* ───────────────────────────── opencode ────────────────────────────────────
 * Seam only. The opencode target (a symlink into
 * ~/.config/opencode/plugins/) lands in the following step. A seam reports
 * rather than throws: an unimplemented target is not a failure, and must not
 * colour the exit status.
 * ────────────────────────────────────────────────────────────────────────── */

const PENDING = "not implemented yet — nothing was written";

const opencodeTarget = {
  name: "opencode",
  root: join(home, ".config", "opencode"),
  install: () => PENDING,
  uninstall: () => PENDING,
};

/* ──────────────────────────────── the walk ─────────────────────────────── */

const TARGETS = [claudeTarget, codexTarget, opencodeTarget];

const uninstalling = process.argv.slice(2).includes("--uninstall");

let anyFailed = false;

for (const target of TARGETS) {
  // The root is what proves the agent exists on this machine. Absent root ⇒
  // skipped and said so, never an error: not having codex installed is normal.
  if (!existsSync(target.root)) {
    console.log(`${target.name}: skipped — ${target.root} does not exist`);
    continue;
  }
  try {
    console.log(`${target.name}: ${uninstalling ? target.uninstall() : target.install()}`);
  } catch (err) {
    anyFailed = true;
    console.error(`install-speech-hook: ${target.name}: ${err.message}`);
  }
}

// Every agent got its turn; the exit status still reports that something broke.
process.exit(anyFailed ? 1 : 0);
