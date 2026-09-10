#!/usr/bin/env node
/*
 * Idempotent installer for the agent-response-speech `Stop` hook.
 *
 * Merges exactly one entry into ~/.claude/settings.json and removes exactly that
 * entry again with `--uninstall`. Everything else in the file — other hooks,
 * other events, unrelated settings — is read, kept, and written back untouched.
 *
 * Registers `Stop` only: `SubagentStop` would fire once per subagent (a dozen
 * times during an execute-plan run) and `Notification` belongs to peon-ping.
 *
 * Run from the repo root as `pnpm install:speech` (add `--uninstall` to remove).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_EVENT = "Stop";
// Identity key: any Stop command referencing this file is ours, whatever the
// absolute prefix. Survives the workspace being moved or cloned elsewhere.
const HOOK_MARKER = "panel/hooks/speak-response.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// The hook is registered, not validated — Task 12 creates the file, and a
// settings entry may legitimately point at a path that does not exist yet.
const hookPath = resolve(scriptDir, "..", "hooks", "speak-response.mjs");
const hookCommand = `node "${hookPath}"`;

// HOME first so a test (or a scripted install into another account) can redirect
// the whole operation; homedir() is the fallback for platforms without HOME.
const home = process.env.HOME || homedir();
const settingsPath = join(home, ".claude", "settings.json");

function fail(message) {
  console.error(`install-speech-hook: ${message}`);
  process.exit(1);
}

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

const uninstalling = process.argv.slice(2).includes("--uninstall");

if (uninstalling && !existsSync(settingsPath)) {
  console.log(`Nothing to remove — ${settingsPath} does not exist.`);
  process.exit(0);
}

const settings = readSettings();
writeSettings(uninstalling ? withoutOurHook(settings) : withOurHook(settings));

console.log(
  uninstalling
    ? `Removed the speech ${HOOK_EVENT} hook from ${settingsPath}`
    : `Registered the speech ${HOOK_EVENT} hook in ${settingsPath}\n  ${hookCommand}`,
);
