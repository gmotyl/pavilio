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

/* ────────────────────────── codex / opencode ───────────────────────────────
 * Seams only. The codex target (a marker-delimited block in
 * ~/.codex/config.toml) and the opencode target (a symlink into
 * ~/.config/opencode/plugins/) land in the following two steps; the shell
 * around them — detection, reporting, failure isolation — is what is being
 * built here. A seam reports rather than throws: an unimplemented target is not
 * a failure, and must not colour the exit status.
 * ────────────────────────────────────────────────────────────────────────── */

const PENDING = "not implemented yet — nothing was written";

const codexTarget = {
  name: "codex",
  root: join(home, ".codex"),
  install: () => PENDING,
  uninstall: () => PENDING,
};

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
