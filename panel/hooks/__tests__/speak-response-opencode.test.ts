import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PavilioSpeechPlugin } from "../speak-response-opencode";

const TERMINAL_ID = "cell-7";
// An obvious dummy. A real token never belongs in a test, a fixture or a log.
const TEST_TOKEN = "test-token";

const MAIN_SESSION = "ses_main";
const CHILD_SESSION = "ses_child";

const ANSWER = "Notes and registry updated, and the batch is committed as 4f2a91c.";

/**
 * The opencode plugin is not a subprocess: it is imported into this test
 * process and driven directly, so there is no stdin payload and no exit status
 * to assert on. What stands in for the agent is a fake `client` and a synthetic
 * event; what stands in for the panel is a real HTTP server, so the POST the
 * plugin makes is the one the panel would actually receive.
 */
interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
}

let server: Server | undefined;
let captured: CapturedRequest[] = [];
let envBackup: NodeJS.ProcessEnv;

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
  process.env.PAVILIO_PANEL_URL = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
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

/** One part of one message, in the shapes `client.session.messages` returns. */
const textPart = (text: string) => ({ id: "prt_text", type: "text", text });
const reasoningPart = (text: string) => ({ id: "prt_reasoning", type: "reasoning", text });
const toolPart = () => ({
  id: "prt_tool",
  type: "tool",
  tool: "bash",
  state: { status: "completed", output: "done" },
});

const userMessage = (text: string) => ({
  info: { id: "msg_user", role: "user" },
  parts: [textPart(text)],
});
const assistantMessage = (parts: unknown[], id = "msg_assistant") => ({
  info: { id, role: "assistant" },
  parts,
});

interface FakeClientOptions {
  /** Session records `client.session.get` answers with, keyed by id. */
  sessions?: Record<string, { id: string; parentID?: string }>;
  /** Message lists `client.session.messages` answers with, keyed by session id. */
  messages?: Record<string, unknown[]>;
  /** When set, every client call rejects with it. */
  throws?: Error;
}

interface FakeClient {
  calls: string[];
  client: unknown;
}

function fakeClient({ sessions = {}, messages = {}, throws }: FakeClientOptions): FakeClient {
  const calls: string[] = [];
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => {
        calls.push(`get:${path.id}`);
        if (throws) throw throws;
        return { data: sessions[path.id] ?? { id: path.id } };
      },
      messages: async ({ path }: { path: { id: string } }) => {
        calls.push(`messages:${path.id}`);
        if (throws) throw throws;
        return { data: messages[path.id] ?? [] };
      },
    },
  };
  return { calls, client };
}

/** Load the plugin and hand it one event, exactly as opencode would. */
async function deliver(client: unknown, event: unknown): Promise<void> {
  const hooks = await PavilioSpeechPlugin({ client } as never);
  await (hooks.event as (input: { event: unknown }) => Promise<void>)({ event });
}

const idleEvent = (sessionID: string) => ({
  type: "session.idle",
  properties: { sessionID },
});

beforeEach(() => {
  captured = [];
  envBackup = { ...process.env };
  process.env.PAVILIO_TERMINAL_ID = TERMINAL_ID;
  // The suite owns the token: never inherit one from the developer's shell.
  delete process.env.PANEL_TOKEN;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  process.env = envBackup;
});

describe("speak-response-opencode", () => {
  it("posts the last assistant message when a main session goes idle", async () => {
    await listenAsPanel();
    process.env.PANEL_TOKEN = TEST_TOKEN;
    const { client, calls } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: {
        [MAIN_SESSION]: [userMessage("what changed?"), assistantMessage([textPart(ANSWER)])],
      },
    });

    await deliver(client, idleEvent(MAIN_SESSION));

    expect(calls).toContain(`messages:${MAIN_SESSION}`);
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/api/speech/utterance");
    // Present only when the panel is token-protected — see the bare case below.
    expect(captured[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(JSON.parse(captured[0].body)).toEqual({ sessionId: TERMINAL_ID, text: ANSWER });
  });

  it("ignores a child session going idle", async () => {
    await listenAsPanel();
    const { client } = fakeClient({
      sessions: { [CHILD_SESSION]: { id: CHILD_SESSION, parentID: MAIN_SESSION } },
      messages: { [CHILD_SESSION]: [assistantMessage([textPart("subagent answer")])] },
    });

    await deliver(client, idleEvent(CHILD_SESSION));

    expect(captured).toEqual([]);
  });

  it("ignores tool parts after the assistant text", async () => {
    await listenAsPanel();
    const { client } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: {
        [MAIN_SESSION]: [
          userMessage("what changed?"),
          assistantMessage([reasoningPart("thinking"), textPart(ANSWER), toolPart()]),
        ],
      },
    });

    await deliver(client, idleEvent(MAIN_SESSION));

    expect(captured).toHaveLength(1);
    // No token in this terminal's environment: the header is omitted entirely.
    expect(captured[0].authorization).toBeUndefined();
    expect(JSON.parse(captured[0].body).text).toBe(ANSWER);
  });

  it("posts nothing when the last assistant message has no text", async () => {
    await listenAsPanel();
    const { client } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: {
        [MAIN_SESSION]: [
          // An earlier answer that must NOT be spoken again: the turn that just
          // ended said nothing, and a stale answer sounds exactly like a fresh
          // one to whoever is listening.
          assistantMessage([textPart("an older answer")], "msg_older"),
          userMessage("run the tests"),
          assistantMessage([toolPart()]),
        ],
      },
    });

    await deliver(client, idleEvent(MAIN_SESSION));

    expect(captured).toEqual([]);
  });

  it("posts nothing without PAVILIO_TERMINAL_ID", async () => {
    await listenAsPanel();
    delete process.env.PAVILIO_TERMINAL_ID;
    const { client, calls } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: { [MAIN_SESSION]: [assistantMessage([textPart(ANSWER)])] },
    });

    await deliver(client, idleEvent(MAIN_SESSION));

    expect(captured).toEqual([]);
    // Nothing to attribute the answer to, so the client is never even asked.
    expect(calls).toEqual([]);
  });

  it("contains a throwing client instead of surfacing it", async () => {
    await listenAsPanel();
    const { client } = fakeClient({ throws: new Error("opencode server went away") });

    await expect(deliver(client, idleEvent(MAIN_SESSION))).resolves.toBeUndefined();
    expect(captured).toEqual([]);
  });

  it("contains a failing POST instead of surfacing it", async () => {
    process.env.PAVILIO_PANEL_URL = await unusedPanelUrl();
    const { client } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: { [MAIN_SESSION]: [assistantMessage([textPart(ANSWER)])] },
    });

    await expect(deliver(client, idleEvent(MAIN_SESSION))).resolves.toBeUndefined();
  });

  it("ignores events other than session.idle", async () => {
    await listenAsPanel();
    const { client, calls } = fakeClient({
      sessions: { [MAIN_SESSION]: { id: MAIN_SESSION } },
      messages: { [MAIN_SESSION]: [assistantMessage([textPart(ANSWER)])] },
    });

    await deliver(client, {
      type: "session.status",
      properties: { sessionID: MAIN_SESSION, status: { type: "busy" } },
    });
    await deliver(client, { type: "message.part.updated", properties: { part: textPart(ANSWER) } });

    expect(calls).toEqual([]);
    expect(captured).toEqual([]);
  });
});
