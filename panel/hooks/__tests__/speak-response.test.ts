import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const HOOK = join(HERE, "..", "speak-response.mjs");
const FIXTURE = join(HERE, "fixtures", "transcript.jsonl");

const TERMINAL_ID = "cell-7";
// An obvious dummy. A real token never belongs in a test, a fixture or a log.
const TEST_TOKEN = "test-token";

// The fixture's last assistant *text* message, and the one before it. The tail
// after LAST_TEXT is tool calls and tool results only.
const LAST_TEXT =
  "Both suites pass — 14 tests, no failures.\n\nThe emitter now posts the last response to the panel, and the route keeps one utterance per session.";
const EARLIER_TEXT = "Starting with the route suite, then the preparation suite.";

/**
 * The shape of the race this suite pins. `PREVIOUS_TEXT` is the answer already
 * in the transcript when the `Stop` hook fires; `CURRENT_TEXT` is the one the
 * user is looking at and has not been appended yet.
 */
const PREVIOUS_TEXT = "This is one sentence.";
const CURRENT_TEXT = "Testing works.";

/**
 * The second shape this suite pins, and the one that actually shipped broken:
 * a single turn that speaks *twice*. `ANNOUNCEMENT` is what the turn says on
 * its way to doing the work; `ANSWER` is what it says when the work is done.
 * Both sit after the same user turn, so "an assistant text after the last user
 * turn" cannot tell them apart — `stop_reason` can.
 */
const ANNOUNCEMENT = "Using pavilio-grill to sharpen this into a design.";
const ANSWER = "Verified before asking: node-side edge-tts works from the worktree.";

/** A real user turn: the human's own message, recorded as a plain string. */
function userTurn(text: string) {
  return { type: "user", message: { role: "user", content: text } };
}

function assistantText(text: string) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

/**
 * An assistant message that records *why* the model stopped, which is what a
 * real Claude Code transcript carries on every assistant entry: `"tool_use"`
 * when the turn is going on to call a tool, `"end_turn"` when this is the
 * turn's answer.
 *
 * The distinction is the whole point of this suite's newest cases: a turn that
 * announces what it is about to do, works, and then answers writes two
 * assistant text messages, and only the second one is worth hearing.
 */
function assistantTextStopping(text: string, stopReason: "tool_use" | "end_turn") {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: stopReason,
    },
  };
}

function toolUse(id: string) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: {} }] },
  };
}

/**
 * A tool result — role `"user"`, `tool_result` blocks, and the `toolUseResult`
 * a real transcript carries alongside them. NOT a user turn, however much the
 * role says otherwise.
 */
function toolResult(id: string) {
  return {
    type: "user",
    toolUseResult: { stdout: "", stderr: "", interrupted: false },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
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

/**
 * Stand-in panel. `respond` decides the answer; `hang` accepts the body and
 * then never answers at all, which is what the timeout test needs.
 */
async function listenAsPanel(
  respond: (res: ServerResponse) => void = (res) => res.writeHead(204).end(),
  { hang = false }: { hang?: boolean } = {},
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
      if (hang) return;
      respond(res);
    });
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  panelUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

/** A port nothing is listening on: bind one, note it, then give it back. */
async function unusedPanelUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

/**
 * Stand-in panel that enforces the same limit the real route does. This mirrors
 * the production mount in `server/panel-server.ts`: the speech-scoped
 * `express.json({ limit: MAX_UTTERANCE_BYTES })` first, the 413 handler sitting
 * next to it second, the utterance handler last — so an over-limit body throws
 * inside the parser and comes back 413, exactly as it would in the panel.
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
      // Only reached once the whole body has been read inside the limit, which
      // is what makes it a trustworthy measure of what the hook actually sent.
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
function run(
  payload: unknown,
  env: Record<string, string | undefined> = {},
): Promise<HookRun> {
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

function stopPayload(transcriptPath: string) {
  return {
    session_id: "claude-session-abc",
    transcript_path: transcriptPath,
    cwd: "/root/git/prv/pavilio",
    hook_event_name: "Stop",
    stop_hook_active: false,
  };
}

beforeEach(() => {
  captured = [];
  answered = [];
  rawBodyBytes = null;
  panelUrl = "";
  scratch = mkdtempSync(join(tmpdir(), "pavilio-speak-response-"));
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("speak-response", () => {
  it("posts the last assistant text message with the terminal id", async () => {
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE), { PANEL_TOKEN: TEST_TOKEN });

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/api/speech/utterance");
    // Bearer from the PTY environment — `hasValidToken` accepts exactly this.
    expect(captured[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: LAST_TEXT,
    });
  });

  it("normalises a trailing slash on PAVILIO_PANEL_URL", async () => {
    // Now that the panel publishes this variable and people set it by hand,
    // `http://127.0.0.1:3012/` is an easy thing to type. Unnormalised it
    // builds `//api/speech/utterance`, which the panel answers 404 to — and
    // this hook swallows a 404 by design, so the only symptom is silence.
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE), {
      PAVILIO_PANEL_URL: `${panelUrl}///`,
    });

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("/api/speech/utterance");
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: LAST_TEXT,
    });
  });

  it("omits the Authorization header without PANEL_TOKEN", async () => {
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBeUndefined();
  });

  it("ignores trailing tool calls and results", async () => {
    // Guard the fixture itself: everything after the emitted text message must
    // be tool traffic, or this test would pass for the wrong reason.
    const entries = readFileSync(FIXTURE, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { message?: { content?: unknown } });
    const blockTypes = (entry: { message?: { content?: unknown } }) =>
      Array.isArray(entry.message?.content)
        ? (entry.message!.content as { type?: string }[]).map((block) => block.type)
        : [];
    const lastTextIndex = entries.findLastIndex((entry) =>
      blockTypes(entry).includes("text"),
    );
    expect(lastTextIndex).toBeGreaterThan(0);
    expect(lastTextIndex).toBeLessThan(entries.length - 1);
    for (const entry of entries.slice(lastTextIndex + 1)) {
      expect(blockTypes(entry).every((type) => type === "tool_use" || type === "tool_result")).toBe(
        true,
      );
    }

    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    const { text } = JSON.parse(captured[0].body) as { text: string };
    expect(text).toBe(LAST_TEXT);
    expect(text).not.toContain("tool_use");
    expect(text).not.toContain("git status --short");
    expect(text).not.toBe(EARLIER_TEXT);
  });

  it("posts nothing and exits 0 without PAVILIO_TERMINAL_ID", async () => {
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE), { PAVILIO_TERMINAL_ID: undefined });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("exits 0 when the panel refuses the connection", async () => {
    panelUrl = await unusedPanelUrl();

    const result = await run(stopPayload(FIXTURE), { PANEL_TOKEN: TEST_TOKEN });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("exits 0 on a missing or malformed transcript", async () => {
    await listenAsPanel();

    const missing = join(scratch, "not-here.jsonl");
    const malformed = join(scratch, "malformed.jsonl");
    writeFileSync(malformed, "{not json at all\n\n{\"type\":\"assistant\"\n");
    const empty = join(scratch, "empty.jsonl");
    writeFileSync(empty, "");
    const toolsOnly = join(scratch, "tools-only.jsonl");
    writeFileSync(
      toolsOnly,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash" }] },
      })}\n`,
    );

    for (const payload of [
      stopPayload(missing),
      stopPayload(malformed),
      stopPayload(empty),
      stopPayload(toolsOnly),
      stopPayload(scratch), // a directory, not a file
      {}, // no transcript named at all
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

  it("abandons the request at the timeout", async () => {
    // The panel reads the body and then goes quiet forever.
    await listenAsPanel(() => {}, { hang: true });

    const startedAt = Date.now();
    const result = await run(stopPayload(FIXTURE));
    const elapsed = Date.now() - startedAt;

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(1);
    // Abandoned, not awaited: it gave up instead of hanging on the open socket.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("prints one diagnostic line to stderr on 401 and still exits 0", async () => {
    await listenAsPanel((res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    });

    const result = await run(stopPayload(FIXTURE), { PANEL_TOKEN: TEST_TOKEN });

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

  it("stays inside the route's cap when the response is far over it", async () => {
    // The cap is on the request *body*, so the trim has to survive the envelope
    // and JSON escaping. This text is built out of the characters that inflate
    // under escaping — quotes, backslashes, newlines — so trimming the text to
    // the cap (the earlier behaviour) leaves a body well over it.
    const unit = 'He said "no" — path C:\\tmp\\x\n';
    const hugeText = unit.repeat(12_000);
    const transcript = join(scratch, "huge.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: hugeText }] },
      })}\n`,
    );

    // Guard the fixture: a text-only trim really would be rejected here, so a
    // 204 below cannot be passing for a trivial reason.
    const textTrimmedToCap = Buffer.from(hugeText, "utf8")
      .subarray(0, MAX_UTTERANCE_BYTES)
      .toString("utf8");
    const bodyOfTextTrim = JSON.stringify({
      sessionId: TERMINAL_ID,
      text: textTrimmedToCap,
    });
    expect(Buffer.byteLength(bodyOfTextTrim)).toBeGreaterThan(MAX_UTTERANCE_BYTES);

    await listenAsCappedPanel();

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    // 204, not 413: the whole utterance survived instead of being dropped.
    expect(answered).toEqual([204]);
    expect(captured).toHaveLength(1);
    expect(rawBodyBytes).not.toBeNull();
    expect(rawBodyBytes!).toBeLessThanOrEqual(MAX_UTTERANCE_BYTES);

    // What arrived is the front of the response, cut, not something else.
    const { sessionId, text } = JSON.parse(captured[0].body) as {
      sessionId: string;
      text: string;
    };
    expect(sessionId).toBe(TERMINAL_ID);
    expect(text.length).toBeGreaterThan(1_000);
    expect(hugeText.startsWith(text)).toBe(true);
  });

  it("says nothing while the current turn's response is missing", async () => {
    // The exact shape the hook fires on: the previous turn's answer, then this
    // turn's user message, and nothing after it yet. Speaking here would speak
    // the previous answer — which is indistinguishable, to the listener, from
    // the right one.
    await listenAsPanel();
    const transcript = writeTranscript("stale.jsonl", [
      userTurn("say one sentence"),
      assistantText(PREVIOUS_TEXT),
      userTurn("test"),
    ]);

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("speaks the response that lands while it is waiting", async () => {
    await listenAsPanel();
    const transcript = writeTranscript("appended.jsonl", [
      userTurn("say one sentence"),
      assistantText(PREVIOUS_TEXT),
      userTurn("test"),
    ]);

    // Claude Code appending the turn it has just finished, a moment after the
    // hook was started — the write the hook is waiting for.
    const append = setTimeout(() => {
      appendFileSync(transcript, `${JSON.stringify(assistantText(CURRENT_TEXT))}\n`);
    }, 100);

    const result = await run(stopPayload(transcript));
    clearTimeout(append);

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: CURRENT_TEXT,
    });
  });

  it("does not mistake a tool result for a new user turn", async () => {
    // A turn that ends after tool use puts a role `"user"` entry *after* the
    // prose. Reading that as a new user turn would make every such turn look
    // unfinished: a full wait, then silence, on the most common shape there is.
    await listenAsPanel();
    const transcript = writeTranscript("tool-tail.jsonl", [
      userTurn("run the suite"),
      assistantText(CURRENT_TEXT),
      toolUse("call-1"),
      toolResult("call-1"),
    ]);

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: CURRENT_TEXT,
    });
  });

  it("waits only when the transcript is behind", async () => {
    // Relative, not absolute: spawning Node dominates the wall clock and varies
    // with the machine, so the fixture — a finished turn whose tail is tool
    // calls and results — is timed against a stale transcript in the same
    // environment. Only the stale run may spend the wait budget.
    await listenAsPanel();

    const completeStartedAt = Date.now();
    const complete = await run(stopPayload(FIXTURE));
    const completeElapsed = Date.now() - completeStartedAt;

    const transcript = writeTranscript("stale-timed.jsonl", [
      userTurn("say one sentence"),
      assistantText(PREVIOUS_TEXT),
      userTurn("test"),
    ]);
    const staleStartedAt = Date.now();
    const stale = await run(stopPayload(transcript));
    const staleElapsed = Date.now() - staleStartedAt;

    expect(complete.status).toBe(0);
    expect(stale.status).toBe(0);
    // The finished turn is still spoken, trailing tool traffic and all...
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: LAST_TEXT,
    });
    // ...and it got there without paying the wait the stale one pays.
    expect(staleElapsed - completeElapsed).toBeGreaterThan(200);
  });

  it("speaks the turn's answer, not an announcement it made on the way", async () => {
    // The bug this suite exists to stop coming back: one turn, two assistant
    // text messages, both after the same user turn. Picking "an assistant text
    // after the last user turn" picks the first — the announcement — and the
    // listener hears the agent describe work instead of report it.
    await listenAsPanel();
    const transcript = writeTranscript("two-texts.jsonl", [
      userTurn("lets try server side synthesis"),
      assistantTextStopping(ANNOUNCEMENT, "tool_use"),
      toolUse("call-1"),
      toolResult("call-1"),
      assistantTextStopping(ANSWER, "end_turn"),
    ]);

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: ANSWER,
    });
  });

  it("says nothing while the turn has announced but not answered", async () => {
    // Exactly the state the transcript is in when `Stop` fires and the answer
    // has not been flushed yet. The announcement is present and complete; it is
    // still not the turn's response, so silence is the only honest answer.
    await listenAsPanel();
    const transcript = writeTranscript("announced-only.jsonl", [
      userTurn("lets try server side synthesis"),
      assistantTextStopping(ANNOUNCEMENT, "tool_use"),
      toolUse("call-1"),
      toolResult("call-1"),
    ]);

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("speaks the answer that lands while it is waiting on an announced turn", async () => {
    await listenAsPanel();
    const transcript = writeTranscript("announced-then-answered.jsonl", [
      userTurn("lets try server side synthesis"),
      assistantTextStopping(ANNOUNCEMENT, "tool_use"),
      toolUse("call-1"),
      toolResult("call-1"),
    ]);

    const append = setTimeout(() => {
      appendFileSync(
        transcript,
        `${JSON.stringify(assistantTextStopping(ANSWER, "end_turn"))}\n`,
      );
    }, 100);

    const result = await run(stopPayload(transcript));
    clearTimeout(append);

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: ANSWER,
    });
  });

  it("falls back to the last assistant text when nothing records a stop_reason", async () => {
    // A transcript whose assistant entries carry no `stop_reason` at all — an
    // older Claude Code, or another writer of the same format. Demanding
    // `end_turn` there would make the feature permanently, silently mute, which
    // is the one outcome this hook is written to avoid. The pre-existing rule
    // still governs those.
    await listenAsPanel();
    const transcript = writeTranscript("no-stop-reason.jsonl", [
      userTurn("run the suite"),
      assistantText(CURRENT_TEXT),
      toolUse("call-1"),
      toolResult("call-1"),
    ]);

    const result = await run(stopPayload(transcript));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: CURRENT_TEXT,
    });
  });
});
