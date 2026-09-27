// Workspace Actions are whatever the workspace itself can actually run.
//
// The panel used to ship a hard-coded list of `pnpm run …` invocations that only
// existed in the maintainer's private workspace, so on a fresh upstream clone
// every button in Settings → Workspace Actions failed. The catalogue below lives
// on the server and is intersected with the `scripts` block of the workspace
// root's own package.json: an action is offered only when the workspace defines
// the script behind it.
//
// Nothing here spawns anything. `node:child_process` is replaced wholesale by a
// vi.fn(), so a regression that shells out on the validation path fails loudly
// (the callback is never invoked, the request hangs) rather than running a real
// setup script against this machine. The workspace root is a fresh temp dir per
// case, so the real package.json is never read either.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";
let workspaceRoot = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";
import agentSettingsRouter from "../agent-settings";

const execMock = vi.mocked(exec);

/** Let a run succeed without a process: answer the callback the route passed. */
function execSucceedsOnce(stdout = "done"): void {
  execMock.mockImplementationOnce(((
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, stdout, "");
    return undefined;
  }) as never);
}

/**
 * Answer the callback with the error `exec` really hands back for a given kill.
 * The two that matter here are not the same object and must not be reported as
 * the same thing: a timeout arrives as `killed: true, signal: "SIGTERM"`, while
 * a maxBuffer overrun arrives as `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`
 * with the partial output still attached.
 */
function execFailsOnce(err: NodeJS.ErrnoException, stdout = "", stderr = ""): void {
  execMock.mockImplementationOnce(((
    _cmd: string,
    _opts: unknown,
    cb: (e: NodeJS.ErrnoException | null, out: string, errOut: string) => void,
  ) => {
    cb(err, stdout, stderr);
    return undefined;
  }) as never);
}

function timeoutError(): NodeJS.ErrnoException {
  const err = new Error("Command failed: . scripts/pm && pm_resolve && pm_in . bootstrap\n") as NodeJS.ErrnoException;
  (err as NodeJS.ErrnoException & { killed?: boolean }).killed = true;
  (err as NodeJS.ErrnoException & { signal?: string }).signal = "SIGTERM";
  return err;
}

function maxBufferError(): NodeJS.ErrnoException {
  const err = new Error("stdout maxBuffer length exceeded") as NodeJS.ErrnoException;
  err.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  return err;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agent-settings", agentSettingsRouter);
  return app;
}

/** The scripts an upstream clone of pavilio defines, verbatim in spirit. */
const UPSTREAM_SCRIPTS: Record<string, string> = {
  bootstrap: "./scripts/bootstrap",
  "setup:shortcut": "./scripts/setup:shortcut",
  "setup:codex": "./scripts/setup:codex",
  "setup:claude-code": "./scripts/setup:claude-code",
  "setup:opencode": "./scripts/setup:opencode",
  "install:speech": "./scripts/install:speech",
  sync: "bash scripts/update.sh",
  start: "./scripts/panel start",
  stop: "./scripts/panel stop",
  status: "./scripts/panel status",
};

function seedPackageJson(scripts: Record<string, string>): void {
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ name: "workspace-under-test", scripts }),
  );
}

async function listedActionIds(): Promise<string[]> {
  const res = await request(makeApp()).get("/api/agent-settings/actions");
  expect(res.status).toBe(200);
  return (res.body as Array<{ id: string }>).map((a) => a.id);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-agent-actions-"));
  workspaceRoot = tmpRoot;
  projectsDir = join(tmpRoot, "projects");
  mkdirSync(projectsDir, { recursive: true });
  execMock.mockReset();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/agent-settings/actions", () => {
  it("lists only allowlisted actions the workspace package.json defines", async () => {
    seedPackageJson(UPSTREAM_SCRIPTS);

    expect(await listedActionIds()).toEqual([
      "setup",
      "update",
      "init:claude",
      "init:opencode",
      "init:codex",
      "install:speech",
    ]);

    // Every entry names the package script it runs. Asserted positively and
    // pairwise: a `script` that went missing would make the negative checks
    // below pass trivially while production ran `pm_in . undefined`.
    const res = await request(makeApp()).get("/api/agent-settings/actions");
    const pairs = (res.body as Array<{ id: string; script: string }>).map((a) => [a.id, a.script]);
    expect(pairs).toEqual([
      ["setup", "bootstrap"],
      ["update", "sync"],
      ["init:claude", "setup:claude-code"],
      ["init:opencode", "setup:opencode"],
      ["init:codex", "setup:codex"],
      ["install:speech", "install:speech"],
    ]);
    // Every script is one this workspace actually defines.
    for (const [id, script] of pairs) {
      expect(Object.keys(UPSTREAM_SCRIPTS), `${id} → ${script}`).toContain(script);
    }

    // Scripts the workspace defines but the catalogue does not describe stay out.
    const scripts = pairs.map(([, script]) => script);
    expect(scripts).not.toContain("setup:shortcut");
    expect(scripts).not.toContain("start");

    // Every entry carries the copy the UI shows; nothing is left for the client.
    for (const action of res.body as Array<Record<string, string>>) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.description.length).toBeGreaterThan(10);
    }
  });

  it("appends workspace-specific backup and restore actions when defined", async () => {
    seedPackageJson({
      ...UPSTREAM_SCRIPTS,
      "setup:backup": "./scripts/setup:backup",
      "setup:restore": "./scripts/setup:restore",
    });

    expect(await listedActionIds()).toEqual([
      "setup",
      "update",
      "init:claude",
      "init:opencode",
      "init:codex",
      "install:speech",
      "setup:backup",
      "setup:restore",
    ]);
  });
});

describe("POST /api/agent-settings/run-action", () => {
  it("rejects an unknown action id with 400 before spawning", async () => {
    seedPackageJson(UPSTREAM_SCRIPTS);

    const res = await request(makeApp())
      .post("/api/agent-settings/run-action")
      .send({ action: "setup; rm -rf /" });

    expect(res.status).toBe(400);
    expect(execMock).not.toHaveBeenCalled();
  });

  it("rejects a defined-in-catalogue but undefined-in-workspace action with 404", async () => {
    // An upstream clone has no backup/restore scripts, but the id is a real one.
    seedPackageJson(UPSTREAM_SCRIPTS);

    const res = await request(makeApp())
      .post("/api/agent-settings/run-action")
      .send({ action: "setup:backup" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Script setup:backup not defined in package.json");
    expect(execMock).not.toHaveBeenCalled();
  });

  it("runs an action through scripts/pm rather than a hard-coded pnpm", async () => {
    seedPackageJson(UPSTREAM_SCRIPTS);
    execSucceedsOnce("claude commands synced");

    const res = await request(makeApp())
      .post("/api/agent-settings/run-action")
      .send({ action: "init:claude" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.output).toBe("claude commands synced");

    expect(execMock).toHaveBeenCalledTimes(1);
    const [command, options] = execMock.mock.calls[0] as [string, { cwd?: string; timeout?: number; shell?: string }];

    // The toolchain is resolved by the workspace's own resolver, not assumed.
    expect(command).toContain(". scripts/pm");
    expect(command).toContain("pm_resolve");
    expect(command).toContain("pm_in . setup:claude-code");
    // The id is not the script; nothing hard-codes a package manager.
    expect(command).not.toMatch(/\bpnpm\b/);
    expect(command).not.toMatch(/\bnpm\b/);

    expect(options.cwd).toBe(workspaceRoot);
    expect(options.timeout).toBe(120_000);
    // `scripts/pm` is bash, and exec's default shell is /bin/sh.
    expect(options.shell).toMatch(/bash$/);
    // exec's default buffer is 1 MB, which an install or a build blows through
    // routinely. Same budget as routes/scripts.ts, which learned this already.
    expect(options.maxBuffer).toBe(4 * 1024 * 1024);
  });

  it("keeps the setup and update ids while running the renamed scripts, on the long timeout", async () => {
    // The ids are the wire contract with the UI and did not move; the package
    // scripts did, because `pnpm setup` and `pnpm update` are pnpm's own
    // subcommands and never reach package.json — nor do `pnpm up` and
    // `pnpm upgrade`, which pnpm documents as aliases of `update`.
    seedPackageJson(UPSTREAM_SCRIPTS);

    seedPackageJson({ ...UPSTREAM_SCRIPTS, "setup:restore": "./scripts/setup:restore" });

    for (const [id, script] of [
      ["setup", "bootstrap"],
      ["update", "sync"],
      ["setup:restore", "setup:restore"],
    ] as const) {
      execMock.mockClear();
      execSucceedsOnce("done");

      const res = await request(makeApp())
        .post("/api/agent-settings/run-action")
        .send({ action: id });

      expect(res.status, `${id} → ${script}`).toBe(200);
      const [command, options] = execMock.mock.calls[0] as [string, { timeout?: number }];
      expect(command).toContain(`pm_in . ${script}`);
      // All three are slow enough to need the long-running budget, keyed by id.
      expect(options.timeout, `${id} timeout`).toBe(300_000);
      // …and the long ones are exactly the verbose ones, so the buffer matters
      // most here.
      expect(options.maxBuffer, `${id} maxBuffer`).toBe(4 * 1024 * 1024);
    }

    // An action that is NOT on the list keeps the two-minute default, so the
    // 300 s branch is a branch and not the only value this can take.
    execMock.mockClear();
    execSucceedsOnce("done");
    await request(makeApp()).post("/api/agent-settings/run-action").send({ action: "install:speech" });
    const [, shortOpts] = execMock.mock.calls[0] as [string, { timeout?: number }];
    expect(shortOpts.timeout).toBe(120_000);
  });

  it("reports a timeout as a timeout, and keeps the output the run did produce", async () => {
    seedPackageJson(UPSTREAM_SCRIPTS);
    execFailsOnce(timeoutError(), "installing dependencies\n", "");

    const res = await request(makeApp())
      .post("/api/agent-settings/run-action")
      .send({ action: "setup" });

    expect(res.status).toBe(504);
    expect(res.body.ok).toBe(false);
    expect(res.body.output).toContain("Timed out after 300s");
    // Throwing the output away is what made a half-finished run unreadable.
    expect(res.body.output).toContain("installing dependencies");
  });

  it("does not call a buffer overrun a timeout", async () => {
    seedPackageJson(UPSTREAM_SCRIPTS);
    execFailsOnce(maxBufferError(), "a lot of build output\n", "");

    const res = await request(makeApp())
      .post("/api/agent-settings/run-action")
      .send({ action: "setup" });

    // A child murdered at the buffer limit is a different diagnosis from one
    // that ran out of time, and `err.killed` is not what separates them.
    expect(res.body.ok).toBe(false);
    expect(res.status).not.toBe(504);
    expect(res.body.output).not.toMatch(/timed out/i);
    // Named as what it is, with the limit that was hit — otherwise the user is
    // left with a truncated log and no reason for the truncation.
    expect(res.body.output).toMatch(/produced more than 4 MB of output/);
    expect(res.body.output).toContain("a lot of build output");
  });
});
