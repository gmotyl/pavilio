import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer as createNetServer, type Server as NetServer } from "net";
import type { AddressInfo } from "net";
import type { Server as HttpServer } from "http";
import type { NextFunction, Request, Response, Router } from "express";

/**
 * The panel's configured port is a wish, not an address: `findFreePort` scans
 * a 50-port span, so a stale panel or an unrelated server on 3010 silently
 * moves the real panel to 3011, 3012, … Until `startPanel` publishes the port
 * it actually resolved, that number lived only in a `console.log` and an
 * in-memory registration — so the speech `Stop` hook kept posting to its
 * hard-coded default and reached whatever was squatting on it instead
 * (observed in the field: a stale panel, answering 404, swallowed silently).
 *
 * Everything with a side effect is mocked away except the sockets, which are
 * the point: a real squatter has to hold the configured port for
 * `findFreePort` to move off it, so the panel binds a real one too. The
 * `registerPanelServer` mock hands the server back so each test can close it.
 */

// A function *declaration*, not a const: vi.mock factories are hoisted above
// every top-level binding, and only declarations are initialised early enough
// for a factory to close over them.
function pass(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
function passRouter(): Router {
  return pass as unknown as Router;
}

// Mutable, test-controlled config: the squatter's port is only known at
// runtime, so `getConfig` has to read it out of here rather than close over a
// literal. `vi.hoisted` for the usual factory-hoisting reason.
const config = vi.hoisted(() => ({ port: 0, explicit: false }));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(async () => {}),
  getConfig: vi.fn(() => ({
    port: config.port,
    projectsDir: "/tmp/pavilio-panel-url-projects",
    tlsCert: undefined,
    tlsKey: undefined,
  })),
  isPortExplicit: vi.fn(() => config.explicit),
}));

vi.mock("../lib/auth.js", () => ({
  authMiddleware: pass,
  loginHandler: pass,
  logoutHandler: pass,
  statusHandler: pass,
}));
vi.mock("../lib/mobile-auth.js", () => ({ loadAuthState: vi.fn(async () => {}) }));
vi.mock("../middleware/mobile-auth.js", () => ({ mobileAuthMiddleware: pass }));

vi.mock("../routes/auth-mobile.js", () => ({ default: passRouter() }));
vi.mock("../routes/mobile-access.js", () => ({ default: passRouter() }));
vi.mock("../routes/projects.js", () => ({ default: passRouter() }));
vi.mock("../routes/files.js", () => ({ default: passRouter() }));
vi.mock("../routes/git.js", () => ({ default: passRouter() }));
vi.mock("../routes/agents.js", () => ({ default: passRouter() }));
vi.mock("../routes/search.js", () => ({ default: passRouter() }));
vi.mock("../routes/images.js", () => ({ default: passRouter() }));
vi.mock("../routes/agent-settings.js", () => ({ default: passRouter() }));
vi.mock("../routes/terminal.js", () => ({ default: passRouter() }));
vi.mock("../routes/scripts.js", () => ({ default: passRouter() }));
vi.mock("../routes/auto-sync.js", () => ({ default: passRouter() }));
vi.mock("../routes/system.js", () => ({ default: passRouter() }));
vi.mock("../routes/archive.js", () => ({ default: passRouter() }));
vi.mock("../routes/time.js", () => ({ mountTimeRoutes: vi.fn() }));

vi.mock("../lib/file-index.js", () => ({ rebuildIndex: vi.fn() }));
vi.mock("../lib/hostname.js", () => ({ machineHostname: vi.fn(() => "test-host") }));
vi.mock("../lib/autoSyncScheduler.js", () => ({ startScheduler: vi.fn() }));
vi.mock("../lib/autoSyncState.js", () => ({ isEnabled: vi.fn(() => false) }));
vi.mock("../watcher.js", () => ({
  setupWebSocket: vi.fn(),
  setupFileWatcher: vi.fn(),
  getWss: vi.fn(),
}));
vi.mock("../lib/agent-registry.js", () => ({ pruneDeadAgents: vi.fn() }));
vi.mock("../lib/panel-listener.js", () => ({ registerPanelServer: vi.fn() }));
vi.mock("../lib/os-users.js", () => ({ listOsUsers: vi.fn(() => []) }));
vi.mock("../lib/terminal-identity.js", () => ({ sweepNames: vi.fn() }));
vi.mock("../lib/terminal-manager.js", () => ({ listSessions: vi.fn(() => []) }));

import { startPanel } from "../panel-server.js";
import { registerPanelServer } from "../lib/panel-listener.js";

let squatter: NetServer | undefined;
let panel: HttpServer | undefined;
let previousPanelUrl: string | undefined;

/** A loopback port nothing is listening on right now. */
async function aFreePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Bind a real loopback port and report it, so findFreePort must skip it. */
async function squatOnAPort(): Promise<number> {
  squatter = createNetServer();
  await new Promise<void>((resolve) => {
    squatter!.listen(0, "127.0.0.1", () => resolve());
  });
  return (squatter!.address() as AddressInfo).port;
}

/** The port the panel really bound, straight off its own registration call. */
function boundPort(): number {
  const call = vi.mocked(registerPanelServer).mock.calls.at(-1);
  expect(call).toBeDefined();
  panel = call![0] as HttpServer;
  return call![1] as number;
}

async function close(server: NetServer | HttpServer | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  previousPanelUrl = process.env.PAVILIO_PANEL_URL;
  delete process.env.PAVILIO_PANEL_URL;
  config.port = 0;
  config.explicit = false;
});

afterEach(async () => {
  vi.useRealTimers();
  if (previousPanelUrl === undefined) delete process.env.PAVILIO_PANEL_URL;
  else process.env.PAVILIO_PANEL_URL = previousPanelUrl;
  // Both sockets are real, so both have to go back — a leaked listener would
  // make the next test's squatter land somewhere unpredictable.
  await close(panel);
  await close(squatter);
  panel = undefined;
  squatter = undefined;
});

describe("startPanel publishes the resolved panel URL", () => {
  it("publishes the port it actually bound, not the configured one", async () => {
    // The field failure, reproduced: something else already holds the
    // configured port, so the panel lands further up the span. Anything
    // reading PAVILIO_PANEL_URL has to hear about the port that won.
    const taken = await squatOnAPort();
    config.port = taken;

    await startPanel(() => {});

    const port = boundPort();
    expect(port).not.toBe(taken);
    expect(process.env.PAVILIO_PANEL_URL).toBe(`http://127.0.0.1:${port}`);
  });

  it("has published the URL before any request can be served", async () => {
    // Ordering is the whole safety argument for the `{ ...process.env }`
    // spread in terminal-manager.ts: terminal sessions are only ever created
    // by the POST /api/terminal/sessions handler, and `mountFrontend` runs
    // after every router is mounted and before `server.listen()` — so a
    // variable already set by then is set before any PTY can exist.
    const taken = await squatOnAPort();
    config.port = taken;

    const seenAtMount: Array<string | undefined> = [];
    await startPanel(() => {
      seenAtMount.push(process.env.PAVILIO_PANEL_URL);
    });

    expect(seenAtMount).toEqual([`http://127.0.0.1:${boundPort()}`]);
  });
});

describe("a port the operator asked for by name", () => {
  it("binds exactly the requested port", async () => {
    // Nothing is holding it, so this is only half the contract — but without it
    // the refusal below could be satisfied by a panel that never starts at all.
    config.port = await aFreePort();
    config.explicit = true;

    await startPanel(() => {});

    expect(boundPort()).toBe(config.port);
  });

  it("refuses to move to another port when the requested one is taken", async () => {
    // The field failure this exists to stop: `scripts/panel start` is told
    // PANEL_PORT, the panel quietly lands one port up, the script times out on
    // the port it was told, and the panel it started keeps running where
    // `scripts/panel stop` will never look for it. Silently relocating off a
    // port the operator named is the whole defect — so refuse, loudly.
    const taken = await squatOnAPort();
    config.port = taken;
    config.explicit = true;

    await expect(startPanel(() => {})).rejects.toThrow(/PANEL_PORT/);

    // Not merely "it threw": nothing may be listening anywhere afterwards.
    expect(vi.mocked(registerPanelServer)).not.toHaveBeenCalled();
    expect(process.env.PAVILIO_PANEL_URL).toBeUndefined();
  });

  it("still auto-increments when the port was only configured, not requested", async () => {
    // The pre-existing behaviour, unchanged: a config-file port is a preference.
    const taken = await squatOnAPort();
    config.port = taken;
    config.explicit = false;

    await startPanel(() => {});

    expect(boundPort()).not.toBe(taken);
  });
});
