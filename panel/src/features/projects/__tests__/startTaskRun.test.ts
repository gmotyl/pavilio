import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubmitReport } from "../../terminal/ptySubmit";

// The pool and the submit queue are replaced: these tests are about WHICH
// session the line reaches and what went to the server, not about xterm or a
// real socket. The socket's handshake is driven by hand through the
// connection listener the code under test subscribes.
type Listener = (state: string) => void;
const listeners = new Map<string, Set<Listener>>();
const lives = new Map<string, { ws: { readyState: number }; send: ReturnType<typeof vi.fn> }>();

vi.mock("../../terminal/terminalInstances", () => ({
  acquireTerminal: vi.fn((sessionId: string) => {
    const live = { sessionId, ws: { readyState: 0 }, send: vi.fn(() => true) };
    lives.set(sessionId, live);
    return live;
  }),
  releaseTerminal: vi.fn(),
  hasExited: vi.fn(() => false),
  onConnectionChange: vi.fn((sessionId: string, cb: Listener) => {
    let set = listeners.get(sessionId);
    if (!set) listeners.set(sessionId, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }),
}));

vi.mock("../../terminal/ptySubmit", () => ({
  submitToPty: vi.fn(
    (_id: string, send: (d: string) => boolean, body: string, report: SubmitReport = {}) => {
      send(body);
      report.onDelivered?.();
      send("\r");
      report.onReturnDelivered?.();
    },
  ),
}));

import { startTaskRun } from "../startTaskRun";
import { acquireTerminal } from "../../terminal/terminalInstances";
import { submitToPty } from "../../terminal/ptySubmit";

const EXISTING = [
  { id: "old-1", name: "pavilio-1", project: "pavilio", cwd: "/w", pid: 1, createdAt: "" },
  { id: "old-2", name: "other-1", project: "other", cwd: "/w", pid: 2, createdAt: "" },
];
const RUN_LINE = 'claude "/goal finish the change"';

let fetchMock: ReturnType<typeof vi.fn>;
let createOk = true;

/** Lands the handshake of the socket the code under test opened for `id`. */
async function openSocket(id: string) {
  await vi.waitFor(() => expect(listeners.get(id)?.size ?? 0).toBeGreaterThan(0));
  lives.get(id)!.ws.readyState = 1;
  for (const cb of [...(listeners.get(id) ?? [])]) cb("connected");
}

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === "/api/terminal/sessions" && init?.method === "POST",
  );
}

beforeEach(() => {
  createOk = true;
  listeners.clear();
  lives.clear();
  vi.mocked(acquireTerminal).mockClear();
  vi.mocked(submitToPty).mockClear();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/terminal/sessions" && init?.method === "POST") {
      if (!createOk) return new Response("boom", { status: 500 });
      return new Response(
        JSON.stringify({ id: "new-1", name: "pavilio-2", project: "pavilio", cwd: "/w" }),
        { status: 201 },
      );
    }
    if (url === "/api/terminal/sessions") {
      return new Response(JSON.stringify(EXISTING), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startTaskRun", () => {
  it("creates a session with the project and no cwd", async () => {
    const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
    await openSocket("new-1");
    await expect(run).resolves.toBe("new-1");

    const posts = postCalls();
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0][1].body as string);
    expect(body.project).toBe("pavilio");
    expect("cwd" in body).toBe(false);
    expect("runAsUser" in body).toBe(false);
  });

  it("writes the run line to the new session only", async () => {
    const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
    await openSocket("new-1");
    await run;

    expect(vi.mocked(submitToPty)).toHaveBeenCalledTimes(1);
    const [id, , body] = vi.mocked(submitToPty).mock.calls[0];
    expect(id).toBe("new-1");
    expect(body).toBe(RUN_LINE);
    // Written only once the socket is open — never into a handshaking one.
    expect(lives.get("new-1")!.send).toHaveBeenCalledWith(RUN_LINE);
  });

  it("leaves existing sessions untouched", async () => {
    const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
    await openSocket("new-1");
    await run;

    const touched = vi.mocked(acquireTerminal).mock.calls.map(([id]) => id);
    expect(touched).toEqual(["new-1"]);
    const submitted = vi.mocked(submitToPty).mock.calls.map(([id]) => id);
    expect(submitted).not.toContain("old-1");
    expect(submitted).not.toContain("old-2");
  });

  it("a failed create surfaces an error and writes nothing", async () => {
    createOk = false;
    await expect(startTaskRun({ project: "pavilio", runLine: RUN_LINE })).rejects.toThrow();
    expect(vi.mocked(acquireTerminal)).not.toHaveBeenCalled();
    expect(vi.mocked(submitToPty)).not.toHaveBeenCalled();
  });
});
