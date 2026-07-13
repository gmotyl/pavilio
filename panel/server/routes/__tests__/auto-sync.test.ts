import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/syncRepo", () => ({
  syncRepo: vi.fn(async () => ({ state: "synced", lastSync: "2026-06-08T00:00:00Z", detail: "", summary: "↑1 ↓0" })),
  getSyncStatus: vi.fn(() => ({ state: "idle", lastSync: null, detail: "", summary: "" })),
  isStale: vi.fn(() => false),
}));
vi.mock("../../lib/autoSyncState", () => ({
  isEnabled: vi.fn(() => true),
  setEnabled: vi.fn(),
}));
vi.mock("../../lib/autoSyncScheduler", () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  isRunning: vi.fn(() => true),
}));
vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/tmp/projects", autoSync: { intervalMinutes: 30, dataPaths: ["projects/"], notifyCmd: "echo hi" } }),
}));
vi.mock("../../lib/hostname", () => ({ machineHostname: () => "testhost" }));

import { syncRepo } from "../../lib/syncRepo";
import * as state from "../../lib/autoSyncState";
import * as sched from "../../lib/autoSyncScheduler";
import autoSyncRouter from "../auto-sync";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auto-sync", autoSyncRouter);
  return app;
}

describe("auto-sync routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /status returns enabled + status + interval", async () => {
    const res = await request(makeApp()).get("/api/auto-sync/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, state: "idle", stale: false, intervalMinutes: 30 });
  });

  it("POST /enable persists, starts scheduler, triggers a sync", async () => {
    const res = await request(makeApp()).post("/api/auto-sync/enable");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, stale: false });
    expect(state.setEnabled).toHaveBeenCalledWith(true);
    expect(sched.startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: expect.any(String),
        hostname: "testhost",
        dataPaths: ["projects/"],
        intervalMinutes: 30,
        notifyCmd: "echo hi",
      })
    );
  });

  it("POST /disable persists + stops scheduler", async () => {
    const res = await request(makeApp()).post("/api/auto-sync/disable");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, stale: false });
    expect(state.setEnabled).toHaveBeenCalledWith(false);
    expect(sched.stopScheduler).toHaveBeenCalled();
  });

  it("POST /now runs syncRepo once", async () => {
    const res = await request(makeApp()).post("/api/auto-sync/now");
    expect(res.status).toBe(200);
    expect(syncRepo).toHaveBeenCalled();
    expect(res.body).toMatchObject({ state: "synced", stale: false });
  });
});
