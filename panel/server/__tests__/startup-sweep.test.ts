import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response, Router } from "express";

/**
 * The identity-file sweep deletes every file in ~/.panel/terminals that does
 * not belong to a live session — and at boot no session is live, so it wipes
 * the lot. That is only safe once startup is past the point where it can
 * still fail: a failed `pnpm start` (missing bundle) must not take the
 * terminal names of an already-running panel with it.
 *
 * Everything with a side effect is mocked away — this exercises the ordering
 * inside startPanel(), not a real server. No port is bound, no watcher runs.
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

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(async () => {}),
  // Port 0 short-circuits findFreePort's probe on the first candidate.
  getConfig: vi.fn(() => ({
    port: 0,
    projectsDir: "/tmp/pavilio-startup-sweep-projects",
    tlsCert: undefined,
    tlsKey: undefined,
  })),
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

// No real socket: the fake server swallows listen() so nothing binds a port.
// Partial mocks — express and node internals still need the rest of these.
vi.mock("http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("http")>()),
  createServer: vi.fn(() => ({
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      cb?.();
    }),
  })),
}));
vi.mock("https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("https")>()),
  createServer: vi.fn(),
}));

import { startPanel } from "../panel-server.js";
import { sweepNames } from "../lib/terminal-identity.js";
import { listSessions } from "../lib/terminal-manager.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startPanel terminal identity sweep", () => {
  it("does not sweep terminal identity files when the frontend fails to mount", async () => {
    const boom = new Error("No built frontend at /nope — run `pnpm build` in panel/ first.");

    await expect(
      startPanel(() => {
        throw boom;
      }),
    ).rejects.toThrow(boom);

    expect(sweepNames).not.toHaveBeenCalled();
  });

  it("sweeps terminal identity files once the frontend has mounted", async () => {
    const mountOrder: string[] = [];
    vi.mocked(sweepNames).mockImplementation(() => {
      mountOrder.push("sweep");
    });

    await startPanel(() => {
      mountOrder.push("mount");
    });

    expect(sweepNames).toHaveBeenCalledTimes(1);
    // Same call, same argument: the live-session ids, empty at boot.
    expect(listSessions).toHaveBeenCalled();
    expect(sweepNames).toHaveBeenCalledWith([]);
    expect(mountOrder).toEqual(["mount", "sweep"]);
  });
});
