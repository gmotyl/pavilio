#!/usr/bin/env node
/*
 * Voice seeding: clones every custom voice in the workspace voice copy
 * (`<workspaceRoot>/.pavilio/voices/<name>/sample.wav` + `voice.json`) that the
 * configured OmniVoice server is missing, through its `POST /v1/voices`.
 *
 * Called by install-speech-hook.mjs after the hooks (never on `--uninstall`, never
 * on panel boot); also runnable on its own as `node panel/scripts/seed-omnivoice-voices.mjs`.
 *
 * It never fails the install: no address, a server that does not answer, or a voice
 * the server rejects is reported in one line each, and the exit code stays 0.
 *
 * It runs on one overall budget (SEED_BUDGET_MS), not a per-voice one alone: Settings →
 * "Install speech" runs install:speech under the panel's default 120 s action timeout
 * (server/routes/agent-settings.ts), and sequential clones of several voices would
 * outlast it and get the whole install killed. A voice the budget does not reach (or
 * cuts off mid-clone) is reported as deferred; the next `pnpm install:speech` picks it
 * up, since voices already on the server are skipped.
 *
 * Plain node, no TS build: the layout mirrors panel/server/lib/speech/workspaceVoices.ts
 * and the address lookup mirrors panel/server/lib/speech/secrets.ts.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADDRESS_VAR = "OPENAI_TTS_BASE_URL";
const SAMPLE_FILE = "sample.wav";
const RECORD_FILE = "voice.json";
const LIST_TIMEOUT_MS = 10_000;
// Cloning encodes the reference audio on the server; the panel proxy allows the same.
const CLONE_TIMEOUT_MS = 120_000;
// The whole seed step, listing included: well inside the Settings action's 120 s, with room
// for node start-up and the hook walk (a test checks it against agent-settings.ts).
const SEED_BUDGET_MS = 90_000;
// The record fields the server's POST takes besides `name` and `file`.
const FORM_FIELDS = ["ref_text", "locale", "gender", "label", "multilingual"];

const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * The OmniVoice address: the environment first, then `<stateDir>/secrets.env`
 * (default `PANEL_AUTH_STATE_DIR ?? ~/.panel`). An empty value counts as absent.
 */
export function resolveBaseUrl({
  env = process.env,
  stateDir = env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel"),
} = {}) {
  if (env[ADDRESS_VAR]) return env[ADDRESS_VAR];
  const file = join(stateDir, "secrets.env");
  if (!existsSync(file)) return undefined;
  // A file edited on Windows has CRLF endings; a `\r` must not end up in the value.
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] === ADDRESS_VAR) return match[2] || undefined;
  }
  return undefined;
}

/** Same rule as workspaceVoices.ts `isSafeVoiceName`. */
function isSafeVoiceName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes("..");
}

/** The names of the workspace voice copies: safe-named dirs holding a `voice.json`, sorted. */
function listWorkspaceVoices(workspaceRoot) {
  const dir = join(workspaceRoot, ".pavilio", "voices");
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && isSafeVoiceName(entry.name))
    .filter((entry) => {
      try {
        return statSync(join(dir, entry.name, RECORD_FILE)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

/** The `detail` of a JSON error body, else the raw text. */
async function detailOf(res) {
  const text = await res.text().catch(() => "");
  try {
    const detail = JSON.parse(text)?.detail;
    if (detail !== undefined) return typeof detail === "string" ? detail : JSON.stringify(detail);
  } catch {
    // Not JSON; the text itself is the detail.
  }
  return text;
}

/** The multipart body the server's `POST /v1/voices` takes. */
function voiceForm(workspaceRoot, name) {
  const dir = join(workspaceRoot, ".pavilio", "voices", name);
  const record = JSON.parse(readFileSync(join(dir, RECORD_FILE), "utf8"));
  const form = new FormData();
  form.append("name", name);
  for (const field of FORM_FIELDS) {
    const value = record?.[field];
    if (value === null || value === undefined) continue;
    // `multilingual` goes as "true"/"false", like every other field a string.
    form.append(field, String(value));
  }
  form.append("file", new Blob([readFileSync(join(dir, SAMPLE_FILE))], { type: "audio/wav" }), SAMPLE_FILE);
  return form;
}

/**
 * Seeds every workspace voice the server lacks, within `budgetMs` overall. Never throws for
 * a server or voice problem; prints one line per problem and a final
 * `voices: seeded N, already there M` (plus failed / deferred counts when there are any).
 * Returns the counts, or `{ skipped }` with the reason when it could not run at all.
 */
export async function seedVoices({
  workspaceRoot,
  baseUrl,
  fetch: fetchImpl = fetch,
  log = console.log,
  budgetMs = SEED_BUDGET_MS,
}) {
  const deadline = Date.now() + budgetMs;
  if (!baseUrl) {
    const reason = `${ADDRESS_VAR} is not set (environment or ~/.panel/secrets.env)`;
    log(`voices: skipped — ${reason}`);
    return { skipped: reason };
  }
  const address = baseUrl.replace(/\/+$/, "");

  let onServer;
  try {
    const res = await fetchImpl(`${address}/v1/voices`, {
      signal: AbortSignal.timeout(Math.max(1, Math.min(LIST_TIMEOUT_MS, deadline - Date.now()))),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    onServer = new Set((Array.isArray(body?.voices) ? body.voices : []).map((voice) => voice?.id));
  } catch (error) {
    const reason = `${address} did not answer (${error.message})`;
    log(`voices: skipped — ${reason}`);
    return { skipped: reason };
  }

  let seeded = 0;
  let present = 0;
  let failed = 0;
  let deferred = 0;
  for (const name of listWorkspaceVoices(workspaceRoot)) {
    if (onServer.has(name)) {
      present += 1;
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      deferred += 1;
      continue;
    }
    // The budget, when it is the tighter limit, cuts the clone off as deferred, not failed.
    const cutByBudget = remaining < CLONE_TIMEOUT_MS;
    try {
      const res = await fetchImpl(`${address}/v1/voices`, {
        method: "POST",
        body: voiceForm(workspaceRoot, name),
        signal: AbortSignal.timeout(Math.min(CLONE_TIMEOUT_MS, remaining)),
      });
      if (!res.ok) throw new Error(`${res.status} ${await detailOf(res)}`.trim());
      seeded += 1;
    } catch (error) {
      if (cutByBudget && error?.name === "TimeoutError") {
        deferred += 1;
        continue;
      }
      failed += 1;
      log(`voices: ${name} failed — ${error.message}`);
    }
  }
  const failedPart = failed ? `, failed ${failed}` : "";
  const deferredPart = deferred ? `, deferred ${deferred} — run pnpm install:speech again` : "";
  log(`voices: seeded ${seeded}, already there ${present}${failedPart}${deferredPart}`);
  return { seeded, present, failed, deferred };
}

/** Seeding with the address from the environment / secrets file — what install:speech runs. */
export function seedFromEnvironment({ workspaceRoot, log = console.log } = {}) {
  return seedVoices({ workspaceRoot, baseUrl: resolveBaseUrl(), log });
}

// CLI entry: the workspace root is the repo root this script lives in.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    await seedFromEnvironment({ workspaceRoot });
  } catch (error) {
    console.log(`voices: skipped — ${error.message}`);
  }
  process.exit(0);
}
