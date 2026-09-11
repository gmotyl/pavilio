#!/usr/bin/env node
/*
 * Claude Code `Stop` hook: emit the agent's finished response to the panel.
 *
 * Reads the hook payload as JSON on stdin, opens the transcript it names, takes
 * the **last assistant text message** out of it, and POSTs
 * `{ sessionId, text }` to `POST /api/speech/utterance`. The panel keeps it as
 * the latest utterance for that session and broadcasts it to open tabs; the
 * browser does the preparation and the synthesis. Nothing is synthesized here.
 *
 * Registered by `scripts/install-speech-hook.mjs`, which points a `Stop` entry
 * at this exact path.
 *
 * ## Never in the way
 *
 * This runs in the agent's critical path, so it always exits 0 and — with one
 * deliberate exception below — prints nothing. A missing panel, a refused
 * connection, a missing/empty/malformed transcript, a rejected body: all
 * silent. One best-effort POST, no retry, no reachability probe.
 *
 * The one exception: a **401** means the panel is running and is permanently
 * refusing us, i.e. misconfigured rather than absent. Swallowing that makes the
 * whole feature silently dead, so it prints a single line to stderr (never the
 * token itself) and still exits 0.
 *
 * ## Which session
 *
 * `PAVILIO_TERMINAL_ID` is put into the PTY's environment by
 * `server/lib/terminal-manager.ts`. Without it there is no cell to attribute
 * the response to, so the hook does nothing at all.
 *
 * ## Auth
 *
 * Sends `Authorization: Bearer ${PANEL_TOKEN}` when `PANEL_TOKEN` is present,
 * which is what `server/lib/auth.ts#hasValidToken` already accepts — no server
 * change, no new auth surface. The header is omitted entirely when the variable
 * is absent, which is the untokened panel where `authMiddleware` no-ops anyway.
 *
 * `terminal-manager.ts` spawns the PTY with `{ ...process.env, … }`, so the
 * panel's own `PANEL_TOKEN` is already inherited by normal terminals.
 *
 * **Known limitation — "run as another user" terminals have no speech.**
 * `server/lib/terminal-run-as.ts` spawns `su - <user> -c "…"`, and `su -`
 * resets the environment, so `PANEL_TOKEN` does not reach the hook there. It is
 * deliberately NOT worked around by putting the token into that command string:
 * a `su -c` command line is visible in `ps aux` to every user on the machine,
 * which would leak the token system-wide. On a token-protected panel, run-as
 * terminals therefore hit the 401 path (one stderr line, exit 0); on an
 * untokened panel they work like any other terminal.
 */
import { readFileSync, writeSync } from "node:fs";

/** Override for tests and for a panel that moved off its configured port. */
const PANEL_URL = process.env.PAVILIO_PANEL_URL ?? "http://127.0.0.1:3010";

/**
 * How long the POST gets before it is abandoned. Short on purpose: the agent's
 * turn is waiting on this process, and the panel is on loopback. The request is
 * aborted rather than awaited, so a wedged panel costs this much and no more.
 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * Mirror of `MAX_UTTERANCE_BYTES` in `server/routes/speech.ts`. Used only to
 * pre-trim, and only *after* the message has been selected — see `trimToCap`.
 */
const MAX_UTTERANCE_BYTES = 100 * 1024;

function readStdin() {
  try {
    // fd 0 in one go: the payload is a single small JSON object, and the hook
    // has nothing to do until all of it has arrived.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Text blocks of one message's content, tool calls and tool results dropped. */
function textOf(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

/**
 * Last assistant message in the transcript that actually carries text.
 *
 * Scans from the end so the newest wins, and skips every entry whose content is
 * only `tool_use` / `tool_result` blocks — an agent turn almost always ends with
 * a run of those, and the thing worth hearing is the prose before them. A line
 * that will not parse is skipped rather than fatal: a half-written last line
 * must not hide the good message above it.
 */
function lastAssistantText(transcript) {
  const lines = transcript.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const message = entry.message ?? entry;
    const role = message?.role ?? entry.type;
    if (role !== "assistant") continue;
    const text = textOf(message?.content);
    if (text !== "") return text;
  }
  return null;
}

/**
 * Keep the body inside the route's cap, which would otherwise answer 413 and
 * drop the whole utterance. Done *after* selecting the message, so nothing is
 * discarded before the choice is made. A response this long does get cut
 * mid-sentence — accepted deliberately: the alternative is hearing nothing at
 * all, and the browser's preparation stage truncates far earlier anyway.
 */
function trimToCap(text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= MAX_UTTERANCE_BYTES) return text;
  // A cut can land inside a multi-byte character; drop the resulting partial.
  return bytes.subarray(0, MAX_UTTERANCE_BYTES).toString("utf8").replace(/\uFFFD+$/u, "");
}

async function post(sessionId, text) {
  const headers = { "content-type": "application/json" };
  // Present only when the panel is token-protected; the value is never logged.
  if (process.env.PANEL_TOKEN) {
    headers.authorization = `Bearer ${process.env.PANEL_TOKEN}`;
  }

  const response = await fetch(`${PANEL_URL}/api/speech/utterance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401) {
    // The single diagnostic this hook is allowed. Names the variable, never its
    // value, and stays one line so it cannot bury the agent's own output.
    writeSync(
      2,
      "speak-response: the panel answered 401, so the response was not spoken. " +
        "PANEL_TOKEN is missing or wrong in this terminal's environment " +
        "(terminals started as another user do not inherit it).\n",
    );
  }
}

async function main() {
  // No cell to attribute the response to: do nothing, quietly.
  const sessionId = process.env.PAVILIO_TERMINAL_ID;
  if (!sessionId) return;

  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    return;
  }
  const transcriptPath = payload?.transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") return;

  let transcript;
  try {
    transcript = readFileSync(transcriptPath, "utf8");
  } catch {
    return;
  }

  const text = lastAssistantText(transcript);
  if (text === null) return;

  await post(sessionId, trimToCap(text));
}

try {
  await main();
} catch {
  // Every failure is a non-event: the agent's turn is not this hook's business.
}
// Explicit: Node's fetch keeps its connection pool warm, which would otherwise
// hold the event loop open after the POST is already done.
process.exit(0);
