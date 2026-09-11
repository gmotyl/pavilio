#!/usr/bin/env node
/*
 * Claude Code `Stop` hook: emit the agent's finished response to the panel.
 *
 * Reads the hook payload as JSON on stdin, opens the transcript it names, takes
 * the **current turn's assistant text message** out of it, and POSTs
 * `{ sessionId, text }` to `POST /api/speech/utterance`. The panel keeps it as
 * the latest utterance for that session and broadcasts it to open tabs; the
 * browser does the preparation and the synthesis. Nothing is synthesized here.
 *
 * ## Which turn — the transcript is not finished when this fires
 *
 * The `Stop` hook runs at the end of the turn, but Claude Code appends the
 * turn's assistant message to `transcript_path` asynchronously, so the file can
 * still end at the *user* message that started this turn. Taking the newest
 * assistant text out of that file yields the PREVIOUS turn's answer — the panel
 * then speaks the last question's answer while the current one is on screen,
 * every turn, for the life of the session.
 *
 * So completeness is checked before anything is sent: a finished turn has an
 * assistant text message **after** the last real user turn. Until it does, this
 * waits (see `TRANSCRIPT_WAIT_MS`) and, if it never appears, sends nothing at
 * all. See `currentResponse`.
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
 * ## Which panel
 *
 * `PAVILIO_PANEL_URL` carries the port the panel actually bound to, which is
 * not necessarily its configured one — `startPanel` takes the first free port
 * in a 50-wide span, so a stale panel or an unrelated server holding 3010
 * moves the real one up. `startPanel` sets that variable on itself (inherited
 * by every normal PTY) and `terminal-run-as.ts` re-injects it into the
 * `su -c` string, since `su -` would otherwise drop it. The default below is
 * only the fallback for a hook running outside a panel-spawned terminal.
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
 * **Known limitation — "run as another user" terminals have no speech on a
 * token-protected panel.** `server/lib/terminal-run-as.ts` spawns
 * `su - <user> -c "…"`, and `su -` resets the environment, so `PANEL_TOKEN`
 * does not reach the hook there. (`PAVILIO_PANEL_URL` does: it is re-injected
 * inline into that command string, which is safe precisely because a URL is
 * not a secret.) The token is deliberately NOT worked around the same way:
 * a `su -c` command line is visible in `ps aux` to every user on the machine,
 * which would leak the token system-wide. On a token-protected panel, run-as
 * terminals therefore hit the 401 path (one stderr line, exit 0); on an
 * untokened panel they work like any other terminal.
 */
import { readFileSync, writeSync } from "node:fs";

/**
 * Override for tests and for a panel that moved off its configured port.
 * `startPanel` publishes the port it actually resolved to into this variable,
 * and a `su -`d terminal gets it re-injected by `terminal-run-as.ts`.
 *
 * Trailing slashes are stripped. This is a variable people also set by hand,
 * and `http://127.0.0.1:3012/` would otherwise build
 * `http://127.0.0.1:3012//api/speech/utterance` — a doubled slash the panel
 * answers 404 to, which this hook then swallows by design, so the symptom is
 * silence with nothing anywhere to explain it.
 */
const PANEL_URL = (process.env.PAVILIO_PANEL_URL ?? "http://127.0.0.1:3010").replace(
  /\/+$/,
  "",
);

/**
 * How long the POST gets before it is abandoned. Short on purpose: the agent's
 * turn is waiting on this process, and the panel is on loopback. The request is
 * aborted rather than awaited, so a wedged panel costs this much and no more.
 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * Mirror of `MAX_UTTERANCE_BYTES` in `server/routes/speech.ts`. The route
 * applies it to the raw **request body** (`express.json({ limit: … })` mounted
 * at `/api/speech`), not to the text inside it. Used only to pre-trim, and only
 * *after* the message has been selected — see `trimToCap`.
 */
const MAX_UTTERANCE_BYTES = 100 * 1024;

/**
 * Headroom kept below that cap. `trimToCap` measures the real serialized body
 * rather than assuming a fixed overhead for the envelope and for JSON escaping,
 * so this margin is not paying for either: it only absorbs the boundary the
 * search cannot land on exactly and any future envelope field. 1 KiB out of
 * 100 KiB costs about ten words of a response that is already being cut.
 */
const BODY_MARGIN_BYTES = 1024;

/**
 * How long to wait for the current turn's assistant message to be appended to
 * the transcript, and how often to re-read the file while waiting.
 *
 * Bounded and small on purpose: the agent's turn is blocked on this process, so
 * this is spent before `REQUEST_TIMEOUT_MS` (1000 ms) even starts. In practice
 * the message lands within a few polls — the writer is the same process tree,
 * on local disk — so the cap is what an unusually slow flush costs, not what a
 * normal turn costs. On expiry the hook says **nothing**: silence is the right
 * answer, because a stale answer sounds exactly like a current one and the
 * listener has no way to tell it is hearing the wrong turn.
 */
const TRANSCRIPT_WAIT_MS = 400;
const TRANSCRIPT_POLL_MS = 20;

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
 * Every entry the transcript can be read as, in file order. A line that will
 * not parse is skipped rather than fatal: a half-written last line — which is
 * exactly what a transcript being appended to right now ends with — must not
 * hide the good message above it.
 */
function parseEntries(transcript) {
  const entries = [];
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry !== null && typeof entry === "object") entries.push(entry);
  }
  return entries;
}

/** Who an entry speaks as. Carried on `message.role`, or as the entry's `type`. */
function roleOf(entry) {
  return (entry.message ?? entry)?.role ?? entry.type;
}

/** One entry's content, wherever it hangs. */
function contentOf(entry) {
  return (entry.message ?? entry)?.content;
}

/**
 * A **real user turn** — something the human actually sent — as opposed to a
 * tool result, which Claude Code records with role `"user"` as well.
 *
 * The two are told apart by the shape of `content`, which is what the
 * transcripts actually differ in:
 *
 * - a human turn is either a plain string (`"test"`) or an array carrying a
 *   `text` (or `image`) block;
 * - a tool result is an array of `tool_result` blocks and nothing else, and the
 *   entry additionally carries a top-level `toolUseResult` — corroboration, not
 *   the test, since the block shape is the thing that is always there.
 *
 * Getting this wrong is the expensive mistake: an agent turn almost always ends
 * with a `tool_use` / `tool_result` pair *after* the prose worth hearing, so
 * counting a tool result as a user turn would make every such turn look
 * permanently unfinished — a full wait, then silence, every time.
 */
function isUserTurn(entry) {
  if (roleOf(entry) !== "user") return false;
  const content = contentOf(entry);
  if (typeof content === "string") return content.trim() !== "";
  if (!Array.isArray(content)) return false;
  return content.some((block) => block?.type && block.type !== "tool_result");
}

/** An assistant message that actually carries prose, not only tool calls. */
function isAssistantText(entry) {
  return roleOf(entry) === "assistant" && textOf(contentOf(entry)) !== "";
}

/** Index of the last entry matching `matches`, or -1. */
function lastIndexWhere(entries, matches) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (matches(entries[i])) return i;
  }
  return -1;
}

/**
 * What the transcript says about the turn that just ended.
 *
 * `stale` is the completeness check, and it needs no memory of previous turns:
 * a finished turn has an assistant text message **after** the last real user
 * turn, so an assistant text sitting *before* it is the previous turn's answer
 * and the current one has not been written yet.
 *
 * `text` is that assistant message, scanned from the end so the newest wins and
 * so a trailing run of `tool_use` / `tool_result` entries is stepped over — the
 * thing worth hearing is the prose before them. It is `null` when the
 * transcript has no assistant prose at all, which is as silent as a stale one
 * but is not worth waiting on.
 *
 * Sidechains are not filtered: a main transcript only ever carries
 * `isSidechain: false` (subagent turns live in a separate `subagents/` tree),
 * and an absent field must not be read as one either way.
 */
function currentResponse(transcript) {
  const entries = parseEntries(transcript);
  const textIndex = lastIndexWhere(entries, isAssistantText);
  const userIndex = lastIndexWhere(entries, isUserTurn);
  if (textIndex < userIndex) return { stale: true, text: null };
  return {
    stale: false,
    text: textIndex === -1 ? null : textOf(contentOf(entries[textIndex])),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The current turn's response, waiting out a transcript the writer has not
 * caught up with. `null` for every ending that must stay silent: an unreadable
 * transcript, one with no assistant prose in it, and one still stale when
 * `TRANSCRIPT_WAIT_MS` runs out.
 */
async function currentResponseText(transcriptPath) {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  for (;;) {
    let transcript;
    try {
      transcript = readFileSync(transcriptPath, "utf8");
    } catch {
      return null;
    }

    const { stale, text } = currentResponse(transcript);
    if (!stale) return text;
    // Re-read rather than watch: the file is local and tiny next to the cost of
    // being wrong, and a watcher would have to be torn down on every path out.
    if (Date.now() >= deadline) return null;
    await sleep(TRANSCRIPT_POLL_MS);
  }
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
 * usable measure: 100 KB of markdown full of quotes, backslashes and newlines
 * serializes to well over 100 KB of body. Done *after* selecting the message,
 * so nothing is discarded before the choice is made. A response this long does
 * get cut mid-sentence — accepted deliberately: the alternative is hearing
 * nothing at all, and the browser's preparation stage truncates far earlier
 * anyway.
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

  const text = await currentResponseText(transcriptPath);
  if (text === null) return;

  await post(sessionId, trimToCap(sessionId, text));
}

try {
  await main();
} catch {
  // Every failure is a non-event: the agent's turn is not this hook's business.
}
// Explicit: Node's fetch keeps its connection pool warm, which would otherwise
// hold the event loop open after the POST is already done.
process.exit(0);
