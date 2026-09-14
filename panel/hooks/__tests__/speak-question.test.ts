import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";

// Importing the route module for its cap constant pulls in the WS fan-out it
// broadcasts through; the stand-in below never needs it.
vi.mock("../../server/watcher", () => ({ broadcast: vi.fn() }));
const { MAX_UTTERANCE_BYTES } = await import("../../server/routes/speech");

// The real browser-side preparation stage, imported rather than imitated. What
// this hook POSTs is not what the voice says: `prepare` strips markdown, splits
// on blank lines, packs the pieces into units and then collapses ALL remaining
// whitespace to single spaces. An assertion on the assembled string alone
// cannot see that, and the bug the numbering below fixes lived entirely in the
// gap between the two strings.
const { prepare } = await import("../../src/features/speech/prepare");

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "speak-question.mjs");
const FIXTURE = join(HERE, "fixtures", "ask-user-question-pretooluse.json");

const TERMINAL_ID = "cell-7";
// An obvious dummy. A real token never belongs in a test, a fixture or a log.
const TEST_TOKEN = "test-token";

/**
 * The captured `PreToolUse` payload from Task 1, with the provenance block —
 * the only part of that file this suite wrote itself — stripped back off. Every
 * field asserted below therefore came off a real hook's stdin, which is the
 * whole reason Task 1 exists: the codex `last_assistant_message` bug came from
 * an assumed payload shape, and this suite refuses to assume one.
 */
interface QuestionPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: {
    questions: {
      question: string;
      header: string;
      multiSelect: boolean;
      options: { label: string; description?: string; preview?: string }[];
    }[];
  };
}

function capturedPayload(): QuestionPayload {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as QuestionPayload & {
    _provenance?: unknown;
  };
  delete raw._provenance;
  return raw;
}

const CAPTURED = capturedPayload();
const CAPTURED_QUESTION = CAPTURED.tool_input.questions[0];
const CAPTURED_LABELS = CAPTURED_QUESTION.options.map((option) => option.label);

/**
 * The spoken shape of a question's options, as the hook must build it: numbered
 * the way the dialog on screen numbers them, each closed with a terminator.
 *
 * Written out here rather than imported, so this suite pins the shape instead
 * of agreeing with whatever the hook currently does. The numbers are digits and
 * the separator is a colon on purpose — `1.`, `1)` and `-` are markdown list
 * markers, and `strip.ts` deletes those before the voice ever sees them, taking
 * the numbering with them.
 */
function numbered(labels: readonly string[]): string {
  return labels
    .map((label, index) => `${index + 1}: ${/[.!?:;…]$/.test(label) ? label : `${label}.`}`)
    .join("\n");
}

/** Prose the assistant wrote in the same message that carries the tool call. */
const PROSE = "Three ways to render archived plans, each with a different cost.";
/** Prose from an EARLIER turn — present in the transcript, never spoken here. */
const STALE_PROSE = "Reading the plans tab to see how the list is grouped today.";
/** A `tool_use` id from a question this session already asked and answered. */
const STALE_TOOL_USE_ID = "toolu_01EarlierQuestionAlreadyAnswered";
/** A `tool_use` id belonging to a subagent's own question, not to this dialog. */
const SIDECHAIN_TOOL_USE_ID = "toolu_01SubagentAskedItsOwnQuestion";
/** Prose from that subagent's message — in the same file, never ours to speak. */
const SIDECHAIN_PROSE = "Checking whether the plans tab already groups by source.";

/**
 * The assistant message a `PreToolUse` hook fires behind: prose, then the
 * `tool_use` block whose id the payload names. `withProse: false` is the shape
 * where the model asked without saying anything first; `isSidechain` is how
 * Claude Code marks a subagent's entries, which it appends to the **parent's**
 * transcript.
 */
function questionMessage(
  toolUseId: string,
  { withProse = true, prose = PROSE, isSidechain = false } = {},
) {
  const content: unknown[] = withProse ? [{ type: "text", text: prose }] : [];
  content.push({
    type: "tool_use",
    id: toolUseId,
    name: "AskUserQuestion",
    input: CAPTURED.tool_input,
  });
  return {
    type: "assistant",
    ...(isSidechain ? { isSidechain: true } : {}),
    message: { role: "assistant", content, stop_reason: "tool_use" },
  };
}

function userTurn(text: string) {
  return { type: "user", message: { role: "user", content: text } };
}

function assistantText(text: string) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }], stop_reason: "tool_use" },
  };
}

function writeTranscript(name: string, entries: unknown[]): string {
  const file = join(scratch, name);
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return file;
}

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
}

let server: Server | undefined;
let panelUrl = "";
let captured: CapturedRequest[] = [];
let scratch: string;
/** Live sockets, so a stand-in that never answers can still be torn down. */
let sockets: Socket[] = [];
/** Statuses the capped stand-in answered with, in order. */
let answered: number[] = [];
/** Raw request-body bytes as the parser counted them; null if it never got there. */
let rawBodyBytes: number | null = null;

/** Stand-in panel. `respond` decides the answer. */
async function listenAsPanel(
  respond: (res: ServerResponse) => void = (res) => res.writeHead(204).end(),
): Promise<void> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      captured.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      respond(res);
    });
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  panelUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

/**
 * A panel that is **absent**: a port bound only long enough to learn its number
 * and then released, so the connection is refused rather than hanging. Asking
 * for an arbitrary high port instead would risk hitting something real on the
 * developer's machine.
 */
async function closedPanelPort(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  panelUrl = `http://127.0.0.1:${port}`;
}

/**
 * A panel that is **slow**: the TCP connection is accepted, the request is read,
 * and no answer is ever written. The only thing that can end that request is the
 * hook's own deadline, which is exactly what the test wants to measure.
 */
async function listenAsSilentPanel(): Promise<void> {
  server = createServer(() => {
    // Deliberately empty: never respond, never end.
  });
  server.on("connection", (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  panelUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

/**
 * Stand-in panel that enforces the same limit the real route does — the
 * speech-scoped `express.json({ limit })`, its 413 handler, then the utterance
 * handler, exactly as `server/panel-server.ts` mounts them.
 */
async function listenAsCappedPanel(): Promise<void> {
  const app = express();
  app.use((_req, res, next) => {
    res.on("finish", () => answered.push(res.statusCode));
    next();
  });
  app.use(
    "/api/speech",
    express.json({
      limit: MAX_UTTERANCE_BYTES,
      verify: (_req, _res, buf: Buffer) => {
        rawBodyBytes = buf.byteLength;
      },
    }),
  );
  app.use("/api/speech", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if ((err as { type?: string } | null)?.type === "entity.too.large") {
      res.status(413).json({ error: "utterance too large", limit: MAX_UTTERANCE_BYTES });
      return;
    }
    next(err);
  });
  app.post("/api/speech/utterance", (req: Request, res: Response) => {
    captured.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.stringify(req.body),
    });
    res.status(204).end();
  });

  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  panelUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the hook and wait for it to exit. Asynchronous on purpose: `spawnSync`
 * would block this process's event loop, so the stand-in panel above could
 * never accept the connection and every request would time out.
 */
function run(payload: unknown, env: Record<string, string | undefined> = {}): Promise<HookRun> {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    PAVILIO_TERMINAL_ID: TERMINAL_ID,
    PAVILIO_PANEL_URL: panelUrl,
    // The suite owns the token: never inherit one from the developer's shell.
    PANEL_TOKEN: undefined,
    ...env,
  };
  for (const key of Object.keys(childEnv)) {
    if (childEnv[key] === undefined) delete childEnv[key];
  }

  const child = spawn(process.execPath, [HOOK], {
    env: childEnv as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));

  return new Promise<HookRun>((resolve) => {
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** The captured payload, pointed at a transcript this test controls. */
function questionPayload(transcriptPath: string, overrides: Record<string, unknown> = {}) {
  return { ...CAPTURED, transcript_path: transcriptPath, ...overrides };
}

beforeEach(() => {
  captured = [];
  answered = [];
  sockets = [];
  rawBodyBytes = null;
  panelUrl = "";
  scratch = mkdtempSync(join(tmpdir(), "pavilio-speak-question-"));
});

afterEach(async () => {
  // A never-answered request leaves its socket open, and `close` waits for
  // every one of them — so they are destroyed first or the suite hangs here.
  for (const socket of sockets) socket.destroy();
  sockets = [];
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("speak-question", () => {
  it("sends prose, question and options as one utterance, in that order", async () => {
    await listenAsPanel();
    const transcript = writeTranscript("asked.jsonl", [
      userTurn("how should archived plans look?"),
      assistantText(STALE_PROSE),
      questionMessage(CAPTURED.tool_use_id),
    ]);

    const result = await run(questionPayload(transcript), { PANEL_TOKEN: TEST_TOKEN });

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/api/speech/utterance");
    // Bearer from the PTY environment — `hasValidToken` accepts exactly this.
    expect(captured[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [PROSE, CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n"),
    });

    // The option *descriptions* and their ASCII-art previews stay out: they are
    // the reading material of a dialog that is on screen, not something worth
    // hearing, and a preview spoken aloud is line-noise.
    const { text } = JSON.parse(captured[0].body) as { text: string };
    expect(text).not.toContain(CAPTURED_QUESTION.options[0].description);
    expect(text).not.toContain("▾");
  });

  it("sends only the question and options when the message carries no prose", async () => {
    await listenAsPanel();
    // An earlier assistant message DOES carry prose. Speaking that would be the
    // same class of bug `speak-response.mjs` was fixed for — prose from the
    // wrong message sounds exactly like prose from the right one.
    const transcript = writeTranscript("no-prose.jsonl", [
      userTurn("how should archived plans look?"),
      assistantText(STALE_PROSE),
      questionMessage(CAPTURED.tool_use_id, { withProse: false }),
    ]);

    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n"),
    });
    expect(captured[0].body).not.toContain(STALE_PROSE);
  });

  it("still posts the question when the transcript is missing or unreadable", async () => {
    // Task 1 captured a live payload whose `transcript_path` names a file that
    // does not exist — a session started with transcript saving off. The
    // question and its options came in on stdin, so there is nothing to wait
    // for and nothing to be silent about: only the prose is lost.
    await listenAsPanel();
    const expected = [CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n");

    const payloads = [
      questionPayload(join(scratch, "not-here.jsonl")),
      questionPayload(scratch), // a directory, not a file
      questionPayload(""), // empty path
      { ...CAPTURED, transcript_path: undefined }, // no transcript named at all
    ];
    for (const payload of payloads) {
      const result = await run(payload);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }

    expect(captured).toHaveLength(payloads.length);
    for (const request of captured) {
      expect(JSON.parse(request.body)).toEqual({ sessionId: TERMINAL_ID, text: expected });
    }
  });

  it("posts nothing for anything that is not an AskUserQuestion with questions", async () => {
    await listenAsPanel();
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    for (const payload of [
      questionPayload(transcript, { tool_name: "Bash" }),
      questionPayload(transcript, { tool_name: undefined }),
      questionPayload(transcript, { tool_input: { questions: [] } }),
      questionPayload(transcript, { tool_input: {} }),
      questionPayload(transcript, { tool_input: undefined }),
      "", // empty stdin
      "{ not json", // unparseable stdin
    ]) {
      const result = await run(payload);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }
    expect(captured).toHaveLength(0);
  });

  it("posts nothing without PAVILIO_TERMINAL_ID", async () => {
    await listenAsPanel();
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    const result = await run(questionPayload(transcript), { PAVILIO_TERMINAL_ID: undefined });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("exits 0 and stays silent when the panel refuses the body", async () => {
    await listenAsPanel((res) => {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "utterance too large" }));
    });
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(1);
  });

  it("prints one stderr line on 401 and still exits 0", async () => {
    await listenAsPanel((res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    });
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    const result = await run(questionPayload(transcript), { PANEL_TOKEN: TEST_TOKEN });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    const lines = result.stderr.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("401");
    expect(lines[0]).toContain("PANEL_TOKEN");
    // A diagnostic that leaks the credential it is complaining about is worse
    // than no diagnostic at all.
    expect(result.stderr).not.toContain(TEST_TOKEN);
  });

  it("trims an oversized body below the route cap", async () => {
    // The cap is on the request *body*, so the trim has to survive the envelope
    // and JSON escaping. This question is built out of the characters that
    // inflate under escaping — quotes, backslashes, newlines — so trimming the
    // text to the cap would still leave a body well over it.
    const unit = 'He said "no" — path C:\\tmp\\x\n';
    const hugeQuestion = unit.repeat(12_000);
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);
    const payload = questionPayload(transcript, {
      tool_input: {
        questions: [
          { question: hugeQuestion, header: "Big", multiSelect: false, options: [{ label: "ok" }] },
        ],
      },
    });

    // Guard the fixture: a text-only trim really would be rejected here, so a
    // 204 below cannot be passing for a trivial reason.
    const textTrimmedToCap = Buffer.from(hugeQuestion, "utf8")
      .subarray(0, MAX_UTTERANCE_BYTES)
      .toString("utf8");
    const bodyOfTextTrim = JSON.stringify({ sessionId: TERMINAL_ID, text: textTrimmedToCap });
    expect(Buffer.byteLength(bodyOfTextTrim)).toBeGreaterThan(MAX_UTTERANCE_BYTES);

    await listenAsCappedPanel();

    const result = await run(payload);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    // 204, not 413: the whole utterance survived instead of being dropped.
    expect(answered).toEqual([204]);
    expect(captured).toHaveLength(1);
    expect(rawBodyBytes).not.toBeNull();
    expect(rawBodyBytes!).toBeLessThanOrEqual(MAX_UTTERANCE_BYTES);

    const { sessionId, text } = JSON.parse(captured[0].body) as {
      sessionId: string;
      text: string;
    };
    expect(sessionId).toBe(TERMINAL_ID);
    expect(text.length).toBeGreaterThan(1_000);
    // What arrived is the front of the utterance, cut — not something else. The
    // cut lands inside the question, so the trailing option label is gone: the
    // trim happens after the utterance is assembled, never before.
    const whole = [PROSE, hugeQuestion.trim(), "1: ok."].join("\n\n");
    expect(whole.startsWith(text)).toBe(true);
    expect(text.startsWith(PROSE)).toBe(true);
  });

  it("speaks every question in the payload, each followed by its own options", async () => {
    // `tool_input.questions` is an array and the dialog shows all of it. Only
    // speaking the first would make the utterance lie about what the turn is
    // actually waiting on, so every question is spoken, in payload order.
    await listenAsPanel();
    const transcript = writeTranscript("asked.jsonl", [
      questionMessage(CAPTURED.tool_use_id, { withProse: false }),
    ]);
    const payload = questionPayload(transcript, {
      tool_input: {
        questions: [
          {
            question: "Where should the bar sit?",
            header: "Placement",
            multiSelect: false,
            options: [{ label: "Below the header" }, { label: "At the bottom edge" }],
          },
          {
            question: "Should it be on by default?",
            header: "Default",
            multiSelect: false,
            options: [{ label: "On" }, { label: "Off" }],
          },
        ],
      },
    });

    const result = await run(payload);

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [
        "Where should the bar sit?",
        "1: Below the header.\n2: At the bottom edge.",
        "Should it be on by default?",
        // Numbering restarts per question, because the dialog numbers each
        // question's own list from one.
        "1: On.\n2: Off.",
      ].join("\n\n"),
    });
  });

  it("numbers the options so preparation keeps each one audible", async () => {
    // The assertion that matters is on the PREPARED text, not on the POSTed
    // one. `prepare` collapses every run of whitespace to a single space, so
    // the newline-separated labels this hook used to send arrived at the voice
    // as "The bar Media keys The keyboard" — one breath, no boundary anywhere,
    // which defeats the point of speaking the question at all. The numbers are
    // what survive that collapse.
    await listenAsPanel();
    const transcript = writeTranscript("asked.jsonl", [
      questionMessage(CAPTURED.tool_use_id, { withProse: false }),
    ]);
    const payload = questionPayload(transcript, {
      tool_input: {
        questions: [
          {
            question: "Which surfaces should drive the transport?",
            header: "Surfaces",
            multiSelect: true,
            options: [{ label: "The bar" }, { label: "Media keys" }, { label: "The keyboard" }],
          },
        ],
      },
    });

    const result = await run(payload);

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    const { text } = JSON.parse(captured[0].body) as { text: string };

    const spoken = prepare(text).units.map((unit) => unit.text);
    expect(spoken).toEqual([
      "Which surfaces should drive the transport?",
      "1: The bar. 2: Media keys. 3: The keyboard.",
    ]);
    // The measured symptom, asserted as absent rather than merely implied by
    // the line above: the three labels must never run together again.
    expect(spoken.join(" ")).not.toContain("The bar Media keys");
    // And `multiSelect` is silent. The picker is on screen when the listener
    // answers, and an English sentence written by a hook would be spliced into
    // a Polish session's prose — the session's language is accumulated in the
    // browser and this process cannot know it.
    expect(spoken.join(" ")).not.toContain("More than one");
  });

  it("takes the prose from the tool call the payload names, not the newest one", async () => {
    // Two `AskUserQuestion` calls in one transcript. The later one is a
    // sidechain entry — a subagent's own question, which Claude Code appends to
    // the parent's transcript — so "the last AskUserQuestion in the file" is
    // not this dialog's. Only `tool_use_id` tells them apart.
    await listenAsPanel();
    const transcript = writeTranscript("two-questions.jsonl", [
      userTurn("how should archived plans look?"),
      questionMessage(CAPTURED.tool_use_id),
      questionMessage(SIDECHAIN_TOOL_USE_ID, { prose: SIDECHAIN_PROSE, isSidechain: true }),
    ]);

    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [PROSE, CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n"),
    });
    expect(captured[0].body).not.toContain(SIDECHAIN_PROSE);
  });

  it("speaks no prose when the named tool call has not been written yet", async () => {
    // Task 1 proved the transcript is not guaranteed to be current — it is not
    // guaranteed to exist. When this dialog's message has not landed, the
    // newest `AskUserQuestion` in the file is the question BEFORE it, and
    // speaking that one's prose is precisely the bug `speak-response.mjs` had
    // to be fixed for. Losing the prose is the correct outcome; inventing it
    // is not.
    await listenAsPanel();
    const transcript = writeTranscript("lagging.jsonl", [
      userTurn("how should archived plans look?"),
      questionMessage(STALE_TOOL_USE_ID, { prose: STALE_PROSE }),
    ]);

    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n"),
    });
    expect(captured[0].body).not.toContain(STALE_PROSE);
  });

  it("falls back to the newest question when the payload omits tool_use_id", async () => {
    // The documented fallback, which without a test is dead code that looks
    // alive: every payload lacking the field would silently lose its prose.
    await listenAsPanel();
    const transcript = writeTranscript("no-id.jsonl", [
      userTurn("how should archived plans look?"),
      assistantText(STALE_PROSE),
      questionMessage(CAPTURED.tool_use_id),
    ]);

    const result = await run(questionPayload(transcript, { tool_use_id: undefined }));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [PROSE, CAPTURED_QUESTION.question, numbered(CAPTURED_LABELS)].join("\n\n"),
    });
  });

  it("exits 0 and stays silent when the panel is absent", async () => {
    await closedPanelPort();
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    const started = Date.now();
    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives up on a panel that never answers instead of holding the question", async () => {
    // `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`, pinned. A `PreToolUse` hook
    // runs while Claude Code waits for it, so an unbounded request here would
    // keep the question dialog from opening at all — the worst possible failure
    // for a feature whose entire job is to help the listener come back to it.
    await listenAsSilentPanel();
    const transcript = writeTranscript("asked.jsonl", [questionMessage(CAPTURED.tool_use_id)]);

    const started = Date.now();
    const result = await run(questionPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
