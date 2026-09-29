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

import { SOCKET_OPEN_TIMEOUT_MS, startTaskRun } from "../startTaskRun";
import { acquireTerminal, hasExited, releaseTerminal } from "../../terminal/terminalInstances";
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
  vi.mocked(releaseTerminal).mockClear();
  vi.mocked(hasExited).mockReset().mockReturnValue(false);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Fires `state` at every listener the code under test holds for `id`. */
function emit(id: string, state: string) {
  for (const cb of [...(listeners.get(id) ?? [])]) cb(state);
}

/** Waits until the code under test is listening for `id`'s connection. */
async function subscribed(id: string) {
  await vi.waitFor(() => expect(listeners.get(id)?.size ?? 0).toBeGreaterThan(0));
}

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

  it("an optimistic connected while the socket is still CONNECTING writes nothing yet", async () => {
    const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
    await subscribed("new-1");
    // The pool's first "connected" is raised at the socket swap, before the
    // handshake lands: readyState is still CONNECTING (0).
    emit("new-1", "connected");
    await Promise.resolve();
    expect(vi.mocked(submitToPty)).not.toHaveBeenCalled();
    expect(lives.get("new-1")!.send).not.toHaveBeenCalled();

    await openSocket("new-1");
    await expect(run).resolves.toBe("new-1");
    expect(vi.mocked(submitToPty)).toHaveBeenCalledTimes(1);
  });

  describe("pool cleanup", () => {
    it("a successful run releases the terminal and drops its listener", async () => {
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      await openSocket("new-1");
      await run;
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
      expect(listeners.get("new-1")?.size ?? 0).toBe(0);
    });

    it("a socket that never opens times out, releases, and unsubscribes", async () => {
      vi.useFakeTimers();
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      const settled = run.catch((e: unknown) => e);
      await subscribed("new-1");
      await vi.advanceTimersByTimeAsync(SOCKET_OPEN_TIMEOUT_MS);
      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/did not connect in time/);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
      expect(listeners.get("new-1")?.size ?? 0).toBe(0);
      expect(vi.mocked(submitToPty)).not.toHaveBeenCalled();
    });

    it("a disconnected socket rejects, releases, and unsubscribes", async () => {
      vi.useFakeTimers();
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      const settled = run.catch((e: unknown) => e);
      await subscribed("new-1");
      emit("new-1", "disconnected");
      const err = await settled;
      expect((err as Error).message).toMatch(/connection failed/);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
      expect(listeners.get("new-1")?.size ?? 0).toBe(0);
      // The timer was cleared with the settle: running it out changes nothing.
      await vi.advanceTimersByTimeAsync(SOCKET_OPEN_TIMEOUT_MS);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledTimes(1);
    });

    it("a process that exited before the run rejects, releases, and unsubscribes", async () => {
      vi.useFakeTimers();
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      const settled = run.catch((e: unknown) => e);
      await subscribed("new-1");
      vi.mocked(hasExited).mockReturnValue(true);
      emit("new-1", "disconnected");
      const err = await settled;
      expect((err as Error).message).toMatch(/exited before the run started/);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
      expect(listeners.get("new-1")?.size ?? 0).toBe(0);
    });

    it("a refused write releases the terminal and says the terminal was created", async () => {
      vi.mocked(submitToPty).mockImplementationOnce((_id, _send, _body, report = {}) => {
        report.onFailed?.("body");
      });
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      const settled = run.catch((e: unknown) => e);
      await openSocket("new-1");
      const err = await settled;
      expect((err as Error).message).toMatch(/terminal was created/i);
      expect((err as Error).message).toMatch(/could not be sent/);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
    });

    it("a refused Enter also says the terminal was created", async () => {
      vi.mocked(submitToPty).mockImplementationOnce((_id, send, body, report = {}) => {
        send(body);
        report.onDelivered?.();
        report.onFailed?.("return");
      });
      const run = startTaskRun({ project: "pavilio", runLine: RUN_LINE });
      const settled = run.catch((e: unknown) => e);
      await openSocket("new-1");
      const err = await settled;
      expect((err as Error).message).toMatch(/terminal was created/i);
      expect(vi.mocked(releaseTerminal)).toHaveBeenCalledWith("new-1");
    });
  });
});
