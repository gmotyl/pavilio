import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountTimeRoutes } from "../time";

let app: express.Express;
let projectsDir: string;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "pavilio-time-route-"));
  app = express();
  app.use(express.json());
  mountTimeRoutes(app, { projectsDir, hostname: "host-a" });
});

describe("POST /api/time/append", () => {
  it("rejects missing project", async () => {
    const r = await request(app).post("/api/time/append").send({ entry: { type: "manual" } });
    expect(r.status).toBe(400);
  });
  it("appends a manual entry and returns the stored row", async () => {
    const r = await request(app)
      .post("/api/time/append")
      .send({ project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90, note: "x" } });
    expect(r.status).toBe(200);
    expect(r.body.entry.id).toMatch(/^[0-9a-z]+$/i);
    expect(r.body.entry.minutes).toBe(90);
  });
  it("rejects unknown entry types", async () => {
    const r = await request(app)
      .post("/api/time/append")
      .send({ project: "metro", entry: { type: "evil" } });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/time/today", () => {
  it("returns all of today's entries across hosts", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: today, minutes: 10, note: "a" },
    });
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "1999-01-01", minutes: 99 },
    });
    const r = await request(app).get("/api/time/today?project=metro");
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(1);
    expect(r.body.totals.busyMinutes).toBe(0);
    expect(r.body.totals.manualMinutes).toBe(10);
  });
});

describe("GET /api/time/range", () => {
  it("returns only manual entries inclusive of both boundaries", async () => {
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-18", minutes: 60, note: "before" },
    });
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-19", minutes: 90, note: "in-low" },
    });
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-21", minutes: 120, note: "in-mid" },
    });
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 30, note: "in-high" },
    });
    await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-26", minutes: 15, note: "after" },
    });
    // non-manual entry on an in-range date should be filtered out
    await request(app).post("/api/time/append").send({
      project: "metro",
      entry: {
        type: "busy_block",
        date: "2026-05-21",
        start: "2026-05-21T09:00:00Z",
        end: "2026-05-21T10:00:00Z",
        minutes: 60,
      },
    });

    const r = await request(app).get(
      "/api/time/range?project=metro&from=2026-05-19&to=2026-05-25",
    );
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(3);
    expect(r.body.entries).toEqual([
      { date: "2026-05-19", minutes: 90, note: "in-low" },
      { date: "2026-05-21", minutes: 120, note: "in-mid" },
      { date: "2026-05-25", minutes: 30, note: "in-high" },
    ]);
  });

  it("400s on missing params", async () => {
    const r = await request(app).get("/api/time/range?project=metro");
    expect(r.status).toBe(400);
  });
});
