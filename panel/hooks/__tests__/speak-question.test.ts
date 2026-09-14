import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";

// Importing the route module for its cap constant pulls in the WS fan-out it
// broadcasts through; the stand-in below never needs it.
vi.mock("../../server/watcher", () => ({ broadcast: vi.fn() }));
const { MAX_UTTERANCE_BYTES } = await import("../../server/routes/speech");

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

/** Prose the assistant wrote in the same message that carries the tool call. */
const PROSE = "Three ways to render archived plans, each with a different cost.";
/** Prose from an EARLIER turn — present in the transcript, never spoken here. */
const STALE_PROSE = "Reading the plans tab to see how the list is grouped today.";

/**
 * The assistant message a `PreToolUse` hook fires behind: prose, then the
 * `tool_use` block whose id the payload names. `withProse: false` is the shape
 * where the model asked without saying anything first.
 */
function questionMessage(toolUseId: string, { withProse = true } = {}) {
  const content: unknown[] = withProse ? [{ type: "text", text: PROSE }] : [];
  content.push({
    type: "tool_use",
    id: toolUseId,
    name: "AskUserQuestion",
    input: CAPTURED.tool_input,
  });
  return {
    type: "assistant",
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
  rawBodyBytes = null;
  panelUrl = "";
  scratch = mkdtempSync(join(tmpdir(), "pavilio-speak-question-"));
});

afterEach(async () => {
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
      text: [PROSE, CAPTURED_QUESTION.question, CAPTURED_LABELS.join("\n")].join("\n\n"),
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
      text: [CAPTURED_QUESTION.question, CAPTURED_LABELS.join("\n")].join("\n\n"),
    });
    expect(captured[0].body).not.toContain(STALE_PROSE);
  });

  it("still posts the question when the transcript is missing or unreadable", async () => {
    // Task 1 captured a live payload whose `transcript_path` names a file that
    // does not exist — a session started with transcript saving off. The
    // question and its options came in on stdin, so there is nothing to wait
    // for and nothing to be silent about: only the prose is lost.
    await listenAsPanel();
    const expected = [CAPTURED_QUESTION.question, CAPTURED_LABELS.join("\n")].join("\n\n");

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
    const whole = [PROSE, hugeQuestion.trim(), "ok"].join("\n\n");
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
        "Below the header\nAt the bottom edge",
        "Should it be on by default?",
        "On\nOff",
      ].join("\n\n"),
    });
  });

  it("says so when a question takes more than one answer", async () => {
    // `multiSelect` is the one fact about the dialog that changes what the
    // listener does when they get back to it, and it is invisible from the
    // labels alone — so it is spoken, once, ahead of the options it governs.
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
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: [
        "Which surfaces should drive the transport?",
        "More than one can be chosen.\nThe bar\nMedia keys\nThe keyboard",
      ].join("\n\n"),
    });
  });
});
