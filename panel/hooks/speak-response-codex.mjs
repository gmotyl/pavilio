#!/usr/bin/env node
/*
 * codex `Stop` hook: emit the agent's finished response to the panel.
 *
 * Reads the hook payload as JSON on stdin, opens the rollout it names, takes
 * the **current turn's answer** out of it, and POSTs `{ sessionId, text }` to
 * `POST /api/speech/utterance` — the same endpoint, the same body and the same
 * auth as the Claude Code emitter next door. The panel keeps it as the latest
 * utterance for that session and broadcasts it to open tabs; the browser does
 * the preparation and the synthesis. Nothing is synthesized here.
 *
 * ## Deliberately not sharing code with `speak-response.mjs`
 *
 * The two emitters repeat maybe thirty lines — the terminal id, the panel URL,
 * the bearer header, one best-effort POST, swallow everything, exit 0 — and
 * that repetition is the point. What they do NOT share is the part that matters
 * on each agent: what a turn's answer *is*. A shared module would have to be
 * installed, versioned and resolved from three hook processes spawned by three
 * different agents, and a bug in it would silence all three at once. Each
 * emitter stays a single file that Node can run with no resolution beyond the
 * standard library.
 *
 * Those thirty lines have since stopped being identical: this one posts over
 * `node:http` rather than `fetch`, because codex alone re-resolves `node`
 * through a login shell and so picks the interpreter for us. See `post`.
 *
 * ## Which turn — `task_complete`, not the newest message
 *
 * A rollout records the turn's prose twice over: as `response_item` `message`
 * items with a `phase` (`"commentary"` on the way through, `"final_answer"` at
 * the end), and as codex's own `event_msg` `task_complete`, which carries
 * `last_agent_message` — the finished answer itself.
 *
 * `task_complete` wins. A turn routinely speaks more than once: it announces
 * what it is about to do ("Finalizing the registry and note changes, then
 * committing…"), works, and then answers. Both messages sit after the same user
 * turn, so picking the newest message by position picks the announcement on
 * every turn caught before its final message is flushed — the listener hears
 * the agent describe work instead of report it. That is the exact bug PR #97
 * fixed for Claude Code, and codex has the same shape waiting for it.
 * `last_agent_message` is not an inference over message records: it is codex
 * saying "the turn ended, and this is what it ended with".
 *
 * It also gives the completeness test for free. The `Stop` hook fires before
 * the rollout has necessarily caught up, so a `task_complete` sitting *before*
 * the last user turn is the PREVIOUS turn's answer — speaking it would answer
 * the last question while the current one is on screen, every turn, for the
 * life of the session. So: no `task_complete` after the last user turn means
 * the turn is unfinished; wait (see `TRANSCRIPT_WAIT_MS`) and, if it never
 * arrives, say nothing at all.
 *
 * ## Which rollout
 *
 * The payload carries `transcript_path`, verified against codex-cli 0.153.0's
 * hook wire schema. context-mode's own codex hook asserts the opposite and
 * walks the sessions tree instead; that claim is stale or version-specific, so
 * the walk is kept only as the fallback — `${CODEX_HOME:-~/.codex}/sessions`,
 * matched on a filename ending `<session_id>.jsonl`.
 *
 * ## Never in the way
 *
 * This runs in the agent's critical path, so it always exits 0 and — with one
 * deliberate exception below — prints nothing. A missing panel, a refused
 * connection, a missing/empty/malformed rollout, a rejected body: all silent.
 * One best-effort POST, no retry, no reachability probe.
 *
 * The one exception: a **401** means the panel is running and is permanently
 * refusing us, i.e. misconfigured rather than absent. Swallowing that makes the
 * whole feature silently dead, so it prints a single line to stderr (never the
 * token itself) and still exits 0.
 *
 * ## Which session, which panel, which auth
 *
 * `PAVILIO_TERMINAL_ID` is put into the PTY's environment by
 * `server/lib/terminal-manager.ts` and inherited by codex and by every process
 * it spawns, this hook included. Without it there is no cell to attribute the
 * response to, so the hook does nothing at all.
 *
 * `PAVILIO_PANEL_URL` carries the port the panel actually bound to, which is
 * not necessarily its configured one — `startPanel` takes the first free port
 * in a 50-wide span. `Authorization: Bearer ${PANEL_TOKEN}` is attached only
 * when that variable is present, which is what `server/lib/auth.ts#hasValidToken`
 * already accepts. Both carry the same caveats as the Claude emitter, including
 * the "run as another user" limitation: `su -` drops `PANEL_TOKEN`, so on a
 * token-protected panel those terminals hit the 401 path.
 *
 * Registered by `scripts/install-speech-hook.mjs`, which points a
 * `[[hooks.Stop]]` entry in `~/.codex/config.toml` at this exact path.
 */
import { readFileSync, readdirSync, statSync, writeSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Override for tests and for a panel that moved off its configured port.
 * Trailing slashes are stripped: `http://127.0.0.1:3012/` would otherwise build
 * `http://127.0.0.1:3012//api/speech/utterance`, a doubled slash the panel
 * answers 404 to — which this hook then swallows by design, so the symptom is
 * silence with nothing anywhere to explain it.
 */
const PANEL_URL = (process.env.PAVILIO_PANEL_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");

/**
 * How long the POST gets before it is abandoned. Short on purpose: the agent's
 * turn is waiting on this process, and the panel is on loopback.
 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * Mirror of `MAX_UTTERANCE_BYTES` in `server/routes/speech.ts`. The route
 * applies it to the raw **request body**, not to the text inside it — see
 * `trimToCap`.
 */
const MAX_UTTERANCE_BYTES = 100 * 1024;

/**
 * Headroom kept below that cap, absorbing the boundary the search cannot land
 * on exactly and any future envelope field.
 */
const BODY_MARGIN_BYTES = 1024;

/**
 * How long to wait for this turn's `task_complete` to be appended to the
 * rollout, and how often to re-read the file while waiting.
 *
 * Bounded and small on purpose: the agent's turn is blocked on this process, so
 * this is spent before `REQUEST_TIMEOUT_MS` even starts. On expiry the hook
 * says **nothing**: a stale answer sounds exactly like a current one, and the
 * listener has no way to tell it is hearing the wrong turn.
 */
const TRANSCRIPT_WAIT_MS = 400;
const TRANSCRIPT_POLL_MS = 20;

/** How deep the fallback walk is allowed to go under `sessions/`. */
const SESSIONS_WALK_DEPTH = 5;

function readStdin() {
  try {
    // fd 0 in one go: the payload is a single small JSON object, and the hook
    // has nothing to do until all of it has arrived.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Every record the rollout can be read as, in file order. A line that will not
 * parse is skipped rather than fatal: a half-written last line — which is
 * exactly what a rollout being appended to right now ends with — must not hide
 * the good record above it.
 */
function parseRecords(rollout) {
  const records = [];
  for (const line of rollout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (record !== null && typeof record === "object") records.push(record);
  }
  return records;
}

/**
 * A **real user turn** — something the human actually sent.
 *
 * Role is the whole test here, and it has to be exact: a rollout's opening
 * records include a `developer` message carrying the permissions preamble and
 * the AGENTS.md instructions, which is emphatically not a turn. Tool traffic,
 * which is what makes this delicate in a Claude Code transcript, is no trouble
 * at all in a rollout: codex records it as `custom_tool_call` /
 * `custom_tool_call_output` items rather than as user messages.
 */
function isUserTurn(record) {
  const payload = record?.payload;
  return (
    record?.type === "response_item" && payload?.type === "message" && payload?.role === "user"
  );
}

/** codex's record that the turn ended, carrying the answer it ended with. */
function isTaskComplete(record) {
  return record?.type === "event_msg" && record?.payload?.type === "task_complete";
}

/** Index of the last record matching `matches`, or -1. */
function lastIndexWhere(records, matches) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (matches(records[i])) return i;
  }
  return -1;
}

/**
 * What the rollout says about the turn that just ended.
 *
 * `stale` is the completeness check, and it needs no memory of previous turns:
 * a finished turn has its `task_complete` after the last user turn, so one
 * sitting *before* that user turn belongs to the previous turn and this one has
 * not been written yet.
 *
 * `text` is that record's `last_agent_message`. It is `null` when the turn
 * ended with nothing to say — a rollout can carry an empty
 * `last_agent_message` — which is as silent as a stale one but is not worth
 * waiting on.
 */
function currentResponse(rollout) {
  const records = parseRecords(rollout);
  const userIndex = lastIndexWhere(records, isUserTurn);
  const completeIndex = lastIndexWhere(records, isTaskComplete);
  if (completeIndex < userIndex || completeIndex === -1) return { stale: true, text: null };
  const message = records[completeIndex].payload?.last_agent_message;
  const text = typeof message === "string" ? message.trim() : "";
  return { stale: false, text: text === "" ? null : text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The current turn's answer, waiting out a rollout the writer has not caught up
 * with. `null` for every ending that must stay silent: an unreadable rollout,
 * one whose turn ended saying nothing, and one still stale when
 * `TRANSCRIPT_WAIT_MS` runs out.
 */
async function currentResponseText(rolloutPath) {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  for (;;) {
    let rollout;
    try {
      rollout = readFileSync(rolloutPath, "utf8");
    } catch {
      return null;
    }

    const { stale, text } = currentResponse(rollout);
    if (!stale) return text;
    // Re-read rather than watch: the file is local and tiny next to the cost of
    // being wrong, and a watcher would have to be torn down on every path out.
    if (Date.now() >= deadline) return null;
    await sleep(TRANSCRIPT_POLL_MS);
  }
}

/**
 * The newest rollout belonging to `sessionId`, found by walking
 * `${CODEX_HOME:-~/.codex}/sessions`, which codex fans out by date
 * (`sessions/2026/09/11/rollout-<timestamp>-<id>.jsonl`).
 *
 * Only the fallback for a build whose `Stop` payload omits `transcript_path`.
 * Matched on the filename's tail rather than on the whole name, because the
 * timestamp between `rollout-` and the id is not ours to predict. Newest wins
 * on the vanishingly unlikely tie, since a resumed session is appended to a new
 * file rather than the old one.
 */
function findRollout(sessionId) {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const suffix = `${sessionId}.jsonl`;
  let best = null;
  let bestTime = -1;

  const walk = (dir, depth) => {
    if (depth > SESSIONS_WALK_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(suffix)) continue;
      try {
        const { mtimeMs } = statSync(path);
        if (mtimeMs > bestTime) {
          best = path;
          bestTime = mtimeMs;
        }
      } catch {
        // Vanished between the listing and the stat: not our problem.
      }
    }
  };

  walk(join(home, "sessions"), 0);
  return best;
}

/** Bytes this pair will actually put on the wire — exactly what `post` sends. */
function bodyBytes(sessionId, text) {
  return Buffer.byteLength(JSON.stringify({ sessionId, text }), "utf8");
}

/** Prefix of `length` UTF-16 units, minus a trailing half of a surrogate pair. */
function cutAt(text, length) {
  const prefix = text.slice(0, length);
  const lastUnit = prefix.charCodeAt(prefix.length - 1);
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? prefix.slice(0, -1) : prefix;
}

/**
 * Keep the **serialized body** inside the route's cap, which would otherwise
 * answer 413 and drop the whole utterance. What the route limits is the body,
 * envelope and JSON escaping included, so the length of the text alone is not a
 * usable measure. Done *after* selecting the answer, so nothing is discarded
 * before the choice is made.
 */
function trimToCap(sessionId, text) {
  const budget = MAX_UTTERANCE_BYTES - BODY_MARGIN_BYTES;
  if (bodyBytes(sessionId, text) <= budget) return text;
  // Longest prefix whose body still fits, by binary search over characters: a
  // character's byte cost is not uniform once escaping is in play, so only
  // measuring the serialized body tells whether a given cut fits.
  let fits = 0;
  let tooLong = text.length;
  while (fits < tooLong) {
    const mid = Math.ceil((fits + tooLong) / 2);
    if (bodyBytes(sessionId, cutAt(text, mid)) <= budget) fits = mid;
    else tooLong = mid - 1;
  }
  return cutAt(text, fits);
}

/**
 * The one best-effort POST — over `node:http`, deliberately, while both sibling
 * emitters use `fetch`.
 *
 * codex does not spawn its hooks with the PTY's environment: it re-resolves the
 * command through a **login shell**, so `node` here is whatever that shell's
 * PATH finds first, which is not the interpreter the panel or codex itself is
 * running under. On the machine this was diagnosed on, the codex PTY held fnm's
 * v20 while `sh -lc 'which node'` answered `/usr/local/bin/node` v16.13.2 — a
 * runtime with neither `fetch` nor `AbortSignal.timeout`. The old `post()` used
 * both, the ReferenceError went straight into this file's catch-all, and the
 * hook exited 0 having said nothing and logged nothing: the feature was silently
 * dead for every codex turn, with no diagnostic anywhere to explain it.
 *
 * So the interpreter version is not ours to assume, and this emitter is pinned
 * to what `node:http` has offered since forever. The divergence from
 * `speak-response.mjs` is deliberate: Claude Code spawns its hooks with the
 * session's own environment (modern node, `fetch` present) and the opencode
 * emitter runs in-process, so only this one is handed an interpreter it did not
 * choose. Do not "harmonise" it back to `fetch` — the unit tests spawn this file
 * under an interpreter with no global `fetch` precisely to stop that.
 *
 * `https` is a real possibility, not defensive dressing: `panel-server.ts`
 * publishes `PAVILIO_PANEL_URL` as `https://…` whenever `tlsCert`/`tlsKey` are
 * configured. Certificate verification is left at its default, which is what
 * `fetch` did too — a panel behind a cert this machine does not trust stays
 * silent rather than being blindly trusted.
 *
 * Resolves rather than rejects on every outcome: the caller has nothing to
 * decide, and a rejection here would only take the same trip through the
 * catch-all.
 */
function post(sessionId, text) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ sessionId, text }), "utf8");
    const headers = {
      "content-type": "application/json",
      // Explicit, because `node:http` would otherwise send this chunked; the
      // byte count is the same one `trimToCap` measured against the route's cap.
      "content-length": String(body.length),
    };
    // Present only when the panel is token-protected; the value is never logged.
    if (process.env.PANEL_TOKEN) {
      headers.authorization = `Bearer ${process.env.PANEL_TOKEN}`;
    }

    // Exactly once, from whichever of the four endings arrives first.
    let settled = false;
    let timer = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };

    let req;
    try {
      const url = new URL(`${PANEL_URL}/api/speech/utterance`);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      req = send(url, { method: "POST", headers }, (response) => {
        if (response.statusCode === 401) {
          // The single diagnostic this hook is allowed. Names the variable,
          // never its value, and stays one line so it cannot bury the agent's
          // own output.
          writeSync(
            2,
            "speak-response-codex: the panel answered 401, so the response was not spoken. " +
              "PANEL_TOKEN is missing or wrong in this terminal's environment " +
              "(terminals started as another user do not inherit it).\n",
          );
        }
        // Drained rather than read: the answer's body is of no interest, and an
        // unread response keeps its socket — and the event loop — alive.
        response.resume();
        response.on("end", settle);
        response.on("error", settle);
      });
    } catch {
      // An unparseable PAVILIO_PANEL_URL, i.e. misconfiguration: as silent as a
      // refused connection, and just as much not this hook's business.
      settle();
      return;
    }

    // A whole-request deadline rather than `req.setTimeout`, which arms an
    // *inactivity* timer on the socket and so cannot bound a panel that answers
    // slowly but steadily. This is what `AbortSignal.timeout` gave us, on a
    // runtime that does not have it. `destroy()` surfaces as the `error` below.
    timer = setTimeout(() => req.destroy(), REQUEST_TIMEOUT_MS);

    // Refused, reset, DNS, our own timeout: every one of them is a non-event.
    req.on("error", settle);
    // Backstop for a socket that dies without ever emitting `error` — the
    // promise must not be the thing that hangs the agent's turn.
    req.on("close", settle);
    req.end(body);
  });
}

/** The rollout the payload names, or the one its session id leads to. */
function rolloutPath(payload) {
  const named = payload?.transcript_path;
  if (typeof named === "string" && named !== "") return named;
  const sessionId = payload?.session_id;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  return findRollout(sessionId);
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

  const path = rolloutPath(payload);
  if (path === null) return;

  const text = await currentResponseText(path);
  if (text === null) return;

  await post(sessionId, trimToCap(sessionId, text));
}

try {
  await main();
} catch {
  // Every failure is a non-event: the agent's turn is not this hook's business.
}
// Kept, but no longer for the reason it was added. The fetch-era justification
// is gone: measured on both interpreters this hook can get (v16.13.2 and
// v22.22.1), removing this line still exits in ~65ms, because `http.Agent`
// unrefs a pooled socket once it is idle — so even the `keepAlive: true`
// default of Node 19+ does not hold the loop open the way fetch's pool did.
//
// What it still buys is the guarantee itself, on a line that costs nothing: the
// agent's turn is blocked on this process, and "exits, immediately, 0" is the
// only promise this hook makes. That must not become contingent on an agent
// pooling policy, a stray timer or a `process.exitCode` set on some path added
// later — least of all here, where the interpreter is not ours to choose.
process.exit(0);
