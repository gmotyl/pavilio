import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "speak-response-codex.mjs");
const FIXTURE = join(HERE, "fixtures", "codex-rollout.jsonl");

const TERMINAL_ID = "cell-7";
// An obvious dummy. A real token never belongs in a test, a fixture or a log.
const TEST_TOKEN = "test-token";

const SESSION_ID = "01a08c22-1e40-7d11-9c0a-6f7b2e5a4d31";

/**
 * The fixture's two assistant messages, both after the same user turn.
 * `COMMENTARY` is what the turn says on its way through the work —
 * `phase: "commentary"` — and `ANSWER` is what it ends with, which is also the
 * `last_agent_message` its `task_complete` record carries. Taking the newest
 * message by position picks the commentary on any turn whose answer has not
 * been flushed yet, which is the bug PR #97 fixed for Claude Code.
 */
const COMMENTARY = "Finalizing the registry and note changes, then committing.";
const ANSWER = "Notes and registry updated, and the batch is committed as 4f2a91c.";

/** A real user turn, as codex records it: a `message` item with `input_text`. */
function userTurn(text: string) {
  return {
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  };
}

function assistantMessage(text: string, phase: "commentary" | "final_answer") {
  return {
    type: "response_item",
    payload: {
      type: "message",
      id: `msg-${phase}`,
      role: "assistant",
      phase,
      content: [{ type: "output_text", text }],
    },
  };
}

/** codex's own record of "the turn ended, and this is what it ended with". */
function taskComplete(text: string) {
  return {
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "turn-1",
      last_agent_message: text,
      started_at: 1789185601,
      completed_at: 1789185611,
      duration_ms: 10_000,
      time_to_first_token_ms: 2400,
    },
  };
}

function writeRollout(name: string, entries: unknown[]): string {
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

/**
 * Stand-in panel. `respond` decides the answer; `hang` accepts the body and
 * then never answers at all, which is what the timeout case needs.
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
    // ...and never let the developer's own rollouts answer the fallback walk.
    CODEX_HOME: join(scratch, "codex-home"),
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
    hook_event_name: "Stop",
    session_id: SESSION_ID,
    turn_id: "turn-1",
    transcript_path: transcriptPath,
    cwd: "/root/git/prv/pavilio",
    model: "gpt-5-codex",
  };
}

beforeEach(() => {
  captured = [];
  panelUrl = "";
  scratch = mkdtempSync(join(tmpdir(), "pavilio-speak-response-codex-"));
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("speak-response-codex", () => {
  it("posts the task_complete answer for a finished turn", async () => {
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/api/speech/utterance");
    expect(JSON.parse(captured[0].body)).toEqual({
      sessionId: TERMINAL_ID,
      text: ANSWER,
    });
  });

  it("posts the answer, not the commentary that preceded it in the same turn", async () => {
    // One turn, two assistant messages, both after the same user turn. The
    // commentary is the *newest* message record here — codex writes the final
    // answer's record and its `task_complete` together, so a turn caught before
    // that flush ends at the announcement. `task_complete` is the only record
    // that says which of the two ended the turn.
    await listenAsPanel();
    const rollout = writeRollout("commentary-then-answer.jsonl", [
      userTurn("process the note batch and commit it"),
      assistantMessage(COMMENTARY, "commentary"),
      taskComplete(ANSWER),
      assistantMessage(COMMENTARY, "commentary"),
    ]);

    const result = await run(stopPayload(rollout));

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    const { text } = JSON.parse(captured[0].body) as { text: string };
    expect(text).toBe(ANSWER);
    expect(text).not.toBe(COMMENTARY);

    // And the same on the fixture, which carries the realistic ordering.
    captured = [];
    const onFixture = await run(stopPayload(FIXTURE));
    expect(onFixture.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect((JSON.parse(captured[0].body) as { text: string }).text).toBe(ANSWER);
  });

  it("posts nothing when the turn has no task_complete yet", async () => {
    // The state the rollout is in when `Stop` fires on a slow flush: the user
    // turn and the announcement are there, the answer is not. Speaking the
    // previous turn's answer here is indistinguishable, to the listener, from
    // speaking the right one — so the only honest answer is silence.
    await listenAsPanel();
    const rollout = writeRollout("unfinished.jsonl", [
      userTurn("say one sentence"),
      taskComplete("This is the previous turn's answer."),
      userTurn("process the note batch and commit it"),
      assistantMessage(COMMENTARY, "commentary"),
    ]);

    const silent = await run(stopPayload(rollout));

    expect(silent.status).toBe(0);
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toBe("");
    expect(captured).toHaveLength(0);

    // ...and it is a wait, not a single read: a `task_complete` appended while
    // the hook is still running is picked up and spoken.
    const appended = writeRollout("appended.jsonl", [
      userTurn("process the note batch and commit it"),
      assistantMessage(COMMENTARY, "commentary"),
    ]);
    const append = setTimeout(() => {
      appendFileSync(appended, `${JSON.stringify(taskComplete(ANSWER))}\n`);
    }, 100);
    const spoken = await run(stopPayload(appended));
    clearTimeout(append);

    expect(spoken.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({ sessionId: TERMINAL_ID, text: ANSWER });
  });

  it("posts nothing and exits 0 without PAVILIO_TERMINAL_ID", async () => {
    await listenAsPanel();

    const result = await run(stopPayload(FIXTURE), { PAVILIO_TERMINAL_ID: undefined });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("finds the rollout by session id when the payload carries no transcript_path", async () => {
    // context-mode's own codex hook asserts the payload has no path at all and
    // walks the sessions tree instead. That is stale for 0.153.0, but the walk
    // is kept as the fallback for the build where it is true.
    await listenAsPanel();
    const home = join(scratch, "codex-home");
    const day = join(home, "sessions", "2026", "09", "11");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, `rollout-2026-09-11T08-00-00-${SESSION_ID}.jsonl`),
      `${[userTurn("process the note batch and commit it"), taskComplete(ANSWER)]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );
    // A neighbour from another session, to prove the match is on the id and not
    // on "the only rollout lying around".
    writeFileSync(
      join(day, "rollout-2026-09-11T09-00-00-01a08c22-dead-beef-9c0a-000000000000.jsonl"),
      `${[userTurn("something else"), taskComplete("Another session's answer.")]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );

    const { transcript_path: _dropped, ...withoutPath } = stopPayload(FIXTURE);
    const result = await run(withoutPath);

    expect(result.status).toBe(0);
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0].body)).toEqual({ sessionId: TERMINAL_ID, text: ANSWER });
  });

  it("exits 0 when the rollout is missing or malformed", async () => {
    await listenAsPanel();

    const missing = join(scratch, "not-here.jsonl");
    const malformed = join(scratch, "malformed.jsonl");
    writeFileSync(malformed, '{not json at all\n\n{"type":"event_msg"\n');
    const empty = join(scratch, "empty.jsonl");
    writeFileSync(empty, "");
    const noAnswer = writeRollout("no-answer.jsonl", [
      userTurn("process the note batch and commit it"),
      taskComplete(""),
    ]);

    for (const payload of [
      stopPayload(missing),
      stopPayload(malformed),
      stopPayload(empty),
      stopPayload(noAnswer),
      stopPayload(scratch), // a directory, not a file
      {}, // no rollout named, and no session id to find one by
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

  it("exits 0 when the panel is unreachable", async () => {
    panelUrl = await unusedPanelUrl();

    const refused = await run(stopPayload(FIXTURE), { PANEL_TOKEN: TEST_TOKEN });

    expect(refused.status).toBe(0);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toBe("");

    // Slow past the timeout: the panel reads the body and then goes quiet
    // forever. The request is abandoned, not awaited.
    await listenAsPanel(() => {}, { hang: true });
    const startedAt = Date.now();
    const hung = await run(stopPayload(FIXTURE));
    const elapsed = Date.now() - startedAt;

    expect(hung.status).toBe(0);
    expect(hung.stdout).toBe("");
    expect(hung.stderr).toBe("");
    expect(captured).toHaveLength(1);
    expect(elapsed).toBeLessThan(5_000);

    // ...and a panel that simply rejects the body is just as silent.
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    captured = [];
    await listenAsPanel((res) => res.writeHead(413).end());
    const rejected = await run(stopPayload(FIXTURE));

    expect(rejected.status).toBe(0);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toBe("");
  });

  it("sends the bearer token only when PANEL_TOKEN is set", async () => {
    await listenAsPanel();

    const tokened = await run(stopPayload(FIXTURE), { PANEL_TOKEN: TEST_TOKEN });
    const untokened = await run(stopPayload(FIXTURE));

    expect(tokened.status).toBe(0);
    expect(untokened.status).toBe(0);
    expect(captured).toHaveLength(2);
    // Bearer from the PTY environment — `hasValidToken` accepts exactly this.
    expect(captured[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(captured[1].authorization).toBeUndefined();
  });

  it("warns once on 401 without printing the token", async () => {
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
});
