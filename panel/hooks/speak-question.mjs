#!/usr/bin/env node
/*
 * Claude Code `PreToolUse` hook, matched on `AskUserQuestion`: emit the
 * question the turn is parked on.
 *
 * Reads the hook payload as JSON on stdin, builds one utterance out of the
 * question(s) it carries — with the assistant's own prose in front of it where
 * the transcript has it — and POSTs `{ sessionId, text }` to
 * `POST /api/speech/utterance`. The same endpoint, the same body and the same
 * auth as `speak-response.mjs` next door, so neither the route nor the server
 * changes for this. The panel keeps it as the latest utterance for that session
 * and broadcasts it to open tabs; the browser does the preparation and the
 * synthesis. Nothing is synthesized here.
 *
 * ## Why this hook exists at all
 *
 * `speak-response.mjs` fires on `Stop` — the end of a turn. A turn that stops
 * to ask a question never reaches it: the dialog opens, the turn hangs there,
 * and the panel says nothing while the agent waits. That is the one moment the
 * listener most needs to hear, because it is the only one where nothing moves
 * until they come back. `PreToolUse` on `AskUserQuestion` fires **while the
 * dialog is still open and unanswered** — verified live, see
 * `__tests__/fixtures/ask-user-question-pretooluse.json` — so it is the event
 * that covers the turn that never ends.
 *
 * ## Everything needed is already on stdin
 *
 * `tool_input.questions[]` carries the question text, its header, its
 * `multiSelect` flag and its option labels. That is the whole utterance bar the
 * prose, which is why this hook — unlike `speak-response.mjs` — has no wait
 * loop, no deadline and no staleness check: there is no file to race. The
 * transcript is read once, best-effort, purely to prefix the prose, and a
 * transcript that is missing, unreadable or simply has not been flushed yet
 * costs the prose and nothing else. The live capture in Task 1 came from a
 * session whose `transcript_path` named a file that does not exist on disk, so
 * that is not a hypothetical path.
 *
 * ## What is spoken, and what is not
 *
 *     <prose>
 *
 *     <question>
 *
 *     1: <label>.
 *     2: <label>.
 *
 * - **Every** question in `questions[]`, in payload order, each immediately
 *   followed by its own options, numbered from one. The array is plural and the
 *   dialog shows all of it; speaking only the first would make the utterance
 *   misdescribe what the turn is actually waiting on.
 * - **The blank lines are not pauses.** They are packing boundaries and nothing
 *   more. `prepare.ts` splits on `\n{2,}` into paragraphs, `packUnits` then
 *   merges consecutive paragraphs up to `UNIT_MAX_CHARS` (450 characters) — a
 *   question and its options are nowhere near that, so they arrive in the *same*
 *   unit — and `toSpokenText` finishes by collapsing every run of whitespace,
 *   newlines included, to a single space. Whatever the listener is meant to hear
 *   as structure therefore has to be carried by the words and the punctuation,
 *   because nothing else survives the trip to the voice. That is the whole
 *   reason the options are numbered and closed with a full stop; see
 *   {@link labelsOf}, which also says why the number is not written `1.`.
 * - **`multiSelect` is not spoken.** It was, once — one English line ahead of
 *   the labels it governed. Two things are wrong with that. The picker is on
 *   screen the moment the listener acts on the question, so the fact is never
 *   actually missing; and a sentence written here, in English, would be spliced
 *   into a Polish session's own prose, because a hook process cannot know the
 *   session's language. That language is accumulated browser-side across
 *   utterances and gates only the pronunciation map — none of it reaches here.
 * - **Option `description` and `preview` are dropped.** They are the reading
 *   material of a dialog that is already on screen; a `preview` in particular
 *   is box-drawing ASCII art, which a TTS voice reads as line noise.
 *
 * ## Deliberately not sharing code with `speak-response.mjs`
 *
 * The same call made for `speak-response-codex.mjs`, for the same reason: the
 * shared part is the boring thirty lines — terminal id, panel URL, bearer
 * header, one best-effort POST, swallow everything, exit 0 — and the part that
 * differs is the part that matters, which here is what the utterance *is*. A
 * shared module would have to be resolved from hook processes spawned by three
 * different agents, and a bug in it would silence all three at once. Each
 * emitter stays a single file Node can run with nothing beyond the standard
 * library.
 *
 * ## Never in the way
 *
 * This runs while the user is being asked a question, so it always exits 0 and
 * — with one deliberate exception — prints nothing. A missing panel, a refused
 * connection, a malformed payload, a rejected body: all silent. One best-effort
 * POST, no retry, no reachability probe.
 *
 * The one exception: a **401** means the panel is running and is permanently
 * refusing us, i.e. misconfigured rather than absent. Swallowing that makes the
 * whole feature silently dead, so it prints a single line to stderr (never the
 * token itself) and still exits 0.
 *
 * ## Which session, which panel, which auth
 *
 * Identical to `speak-response.mjs`, down to the reasoning: `PAVILIO_TERMINAL_ID`
 * names the cell (absent → do nothing at all), `PAVILIO_PANEL_URL` carries the
 * port the panel actually bound to rather than its configured one, and
 * `PANEL_TOKEN` becomes a bearer header only when it is present. See that file
 * for the long form, including why run-as terminals hit the 401 path on a
 * token-protected panel.
 *
 * Registered by `scripts/install-speech-hook.mjs`, which points a `PreToolUse`
 * entry with matcher `AskUserQuestion` at this exact path.
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
 * How long the POST gets before it is abandoned. Short on purpose: the user is
 * looking at an open question, and the panel is on loopback. The request is
 * aborted rather than awaited, so a wedged panel costs this much and no more.
 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * Mirror of `MAX_UTTERANCE_BYTES` in `server/routes/speech.ts`. The route
 * applies it to the raw **request body** (`express.json({ limit: … })` mounted
 * at `/api/speech`), not to the text inside it. Used only to pre-trim, and only
 * *after* the utterance has been built — see `trimToCap`.
 */
const MAX_UTTERANCE_BYTES = 100 * 1024;

/**
 * Headroom kept below that cap. `trimToCap` measures the real serialized body
 * rather than assuming a fixed overhead for the envelope and for JSON escaping,
 * so this margin is not paying for either: it only absorbs the boundary the
 * search cannot land on exactly and any future envelope field.
 */
const BODY_MARGIN_BYTES = 1024;

/** The tool this hook is registered for. Anything else is not ours to speak. */
const QUESTION_TOOL = "AskUserQuestion";

/**
 * What counts as a label that already ends a sentence. Mirrors
 * `SENTENCE_TERMINATOR_RE` in `src/features/speech/strip.ts`, which closes a
 * list item that has none for exactly the reason {@link labelsOf} does it here:
 * so the items are spoken as separate sentences rather than one long clause.
 */
const SENTENCE_TERMINATOR_RE = /[.!?:;…]$/;

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

/** One entry's content, wherever it hangs. */
function contentOf(entry) {
  return (entry.message ?? entry)?.content;
}

/**
 * Whether this entry is the assistant message that made **this** tool call.
 *
 * Matched on `tool_use_id`, which the payload hands us, rather than on
 * position: a turn routinely speaks several times before it asks, and prose
 * from the wrong message sounds exactly like prose from the right one. That
 * mistake is the one `speak-response.mjs` had to be fixed for, and there is no
 * reason to re-make it here when the payload names the block outright.
 *
 * The fallback — any `AskUserQuestion` call — is for a payload that omits
 * `tool_use_id`. It is still this turn's question, because the transcript is
 * scanned from the end and the dialog it belongs to is open right now.
 */
function makesCall(entry, toolUseId) {
  const content = contentOf(entry);
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block?.type === "tool_use" &&
      (toolUseId ? block.id === toolUseId : block.name === QUESTION_TOOL),
  );
}

/**
 * The assistant's prose from the message carrying this tool call — what it said
 * on its way to asking. `""` for every reason it might not be there: no
 * transcript named, a path that does not resolve to a readable file (the live
 * capture in Task 1 had exactly that), a message that called the tool without
 * saying anything first, or a message that has not been flushed yet.
 *
 * Read once, with no wait loop. `speak-response.mjs` polls because the thing it
 * is waiting for is the *entire* utterance; here it is a prefix, and holding an
 * open question silent while waiting on a nicety would be the wrong trade.
 */
function proseFor(transcriptPath, toolUseId) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return "";
  let transcript;
  try {
    transcript = readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const entries = parseEntries(transcript);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (makesCall(entries[i], toolUseId)) return textOf(contentOf(entries[i]));
  }
  return "";
}

/**
 * A question's option labels, numbered, one per line. Malformed options are
 * dropped before numbering, so the numbers always count what is actually said.
 *
 * The numbering is what makes the options audible *as* options. `prepare.ts`
 * collapses every run of whitespace to a single space, so the newline between
 * two labels is not a pause, not a boundary, not anything: `The bar\nMedia
 * keys\nThe keyboard` reaches the voice as "The bar Media keys The keyboard" —
 * one phrase, which a listener cannot take apart. A number in front of each
 * label survives that collapse, and it is the same number the dialog on screen
 * shows, so "two" names the same option in both places.
 *
 * `1.`, `1)` and `- ` are all avoided deliberately: those are markdown list
 * markers, and `strip.ts` strips the marker off a list item before the browser
 * prepares the text — the numbering would be deleted on the way to the voice,
 * which is worse than never adding it, because the code would look right. A
 * digit followed by a colon is a list marker nowhere, and it stays.
 *
 * Digits rather than words ("one", "two") because this process cannot know the
 * session's language — see the `multiSelect` note in the module header. A digit
 * is read by the voice in whatever language it is already speaking; "one" is
 * English wherever it lands.
 */
function labelsOf(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  return options
    .map((option) => (typeof option?.label === "string" ? option.label.trim() : ""))
    .filter((label) => label !== "")
    .map(
      (label, index) =>
        `${index + 1}: ${SENTENCE_TERMINATOR_RE.test(label) ? label : `${label}.`}`,
    );
}

/**
 * The blocks one question contributes: the question itself, then its options —
 * so the listener hears what is being asked before what they may answer with.
 * A question with no usable options still gets asked; a question with no text
 * contributes nothing, since a bare list of labels answers nothing.
 *
 * Numbering restarts at one per question, because that is how the dialog
 * numbers each question's own list.
 */
function blocksFor(question) {
  const text = typeof question?.question === "string" ? question.question.trim() : "";
  if (text === "") return [];
  const lines = labelsOf(question);
  return lines.length === 0 ? [text] : [text, lines.join("\n")];
}

/**
 * The whole utterance, or `""` when there is nothing to say.
 *
 * Blocks are joined by a blank line because that is the paragraph separator
 * `prepare.ts` reads — but a paragraph boundary is NOT a pause, and this is the
 * one place where believing it is would be easy: `packUnits` merges short
 * paragraphs into one unit and `toSpokenText` collapses the newlines to spaces,
 * so this whole utterance typically reaches the voice as one or two units with
 * single spaces where the blank lines were. The audible structure comes from
 * the punctuation the blocks carry, not from how they are joined here.
 */
function utteranceFor(payload, prose) {
  const questions = payload?.tool_input?.questions;
  if (!Array.isArray(questions)) return "";
  const blocks = questions.flatMap((question) => blocksFor(question));
  if (blocks.length === 0) return "";
  return (prose === "" ? blocks : [prose, ...blocks]).join("\n\n");
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
 * serializes to well over 100 KB of body. Done *after* the utterance is built,
 * so nothing is discarded before it is assembled.
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
      "speak-question: the panel answered 401, so the question was not spoken. " +
        "PANEL_TOKEN is missing or wrong in this terminal's environment " +
        "(terminals started as another user do not inherit it).\n",
    );
  }
}

async function main() {
  // No cell to attribute the question to: do nothing, quietly.
  const sessionId = process.env.PAVILIO_TERMINAL_ID;
  if (!sessionId) return;

  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    return;
  }
  // Registration matches on the tool name, but a matcher is configuration and
  // this check is not: a hook that speaks whatever it is pointed at would turn
  // a mis-registration into a stream of nonsense utterances.
  if (payload?.tool_name !== QUESTION_TOOL) return;

  const prose = proseFor(payload.transcript_path, payload.tool_use_id);
  const text = utteranceFor(payload, prose);
  if (text === "") return;

  await post(sessionId, trimToCap(sessionId, text));
}

try {
  await main();
} catch {
  // Every failure is a non-event: the open question is not this hook's business.
}
// Explicit: Node's fetch keeps its connection pool warm, which would otherwise
// hold the event loop open after the POST is already done.
process.exit(0);
