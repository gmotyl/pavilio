import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountTimeRoutes } from "../time";
import { localISODate } from "../../lib/dateLocal";

let app: express.Express;
let projectsDir: string;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "pavilio-time-route-"));
  app = express();
  app.use(express.json());
  mountTimeRoutes(app, { projectsDir, hostname: "host-a" });
});

describe("POST /api/time/append", () => {
  it("appends a manual entry and returns the stored row", async () => {
    const r = await request(app)
      .post("/api/time/append")
      .send({ project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90, note: "x" } });
    expect(r.status).toBe(200);
    expect(r.body.entry.id).toMatch(/^[0-9a-z]+$/i);
    expect(r.body.entry.minutes).toBe(90);
  });
});

describe("GET /api/time/today", () => {
  it("returns all of today's entries across hosts", async () => {
    // Server endpoint buckets by local date; the seeded entry must match.
    const today = localISODate();
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
});

describe("PATCH /api/time/entry/:id", () => {
  it("updates minutes and the change is visible in GET /api/time/range", async () => {
    const post = await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90, note: "PR" },
    });
    const id = post.body.entry.id;
    const r = await request(app).patch(`/api/time/entry/${id}`).send({
      project: "metro", patch: { minutes: 60 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    const range = await request(app).get(
      "/api/time/range?project=metro&from=2026-05-25&to=2026-05-25",
    );
    expect(range.body.entries).toEqual([
      { date: "2026-05-25", minutes: 60, note: "PR" },
    ]);
  });

  it("updates the note", async () => {
    const post = await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90, note: "old" },
    });
    const id = post.body.entry.id;
    const r = await request(app).patch(`/api/time/entry/${id}`).send({
      project: "metro", patch: { note: "new" },
    });
    expect(r.status).toBe(200);
    const range = await request(app).get(
      "/api/time/range?project=metro&from=2026-05-25&to=2026-05-25",
    );
    expect(range.body.entries[0].note).toBe("new");
  });

  it("404 on unknown id", async () => {
    const r = await request(app).patch("/api/time/entry/missing").send({
      project: "metro", patch: { minutes: 60 },
    });
    expect(r.status).toBe(404);
  });

  it.each<[string, Record<string, unknown>]>([
    ["minutes is negative", { minutes: -5 }],
    ["minutes is non-integer", { minutes: 1.5 }],
    ["date is malformed", { date: "not-a-date" }],
  ])("400 when %s", async (_label, patch) => {
    const post = await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90 },
    });
    const id = post.body.entry.id;
    const r = await request(app).patch(`/api/time/entry/${id}`).send({ project: "metro", patch });
    expect(r.status).toBe(400);
  });
});

describe("DELETE /api/time/entry/:id", () => {
  it("removes the entry so GET /api/time/range no longer returns it", async () => {
    const post = await request(app).post("/api/time/append").send({
      project: "metro", entry: { type: "manual", date: "2026-05-25", minutes: 90, note: "x" },
    });
    const id = post.body.entry.id;
    const r = await request(app).delete(`/api/time/entry/${id}?project=metro`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const range = await request(app).get(
      "/api/time/range?project=metro&from=2026-05-25&to=2026-05-25",
    );
    expect(range.body.entries).toEqual([]);
  });

  it("404 on unknown id", async () => {
    const r = await request(app).delete("/api/time/entry/missing?project=metro");
    expect(r.status).toBe(404);
  });
});

type Method = "get" | "post" | "patch" | "delete";
// One row per rejected request: [label, method, url, json body].
type BadRequest = [string, Method, string, object?];

function send(method: Method, url: string, body?: object) {
  const req = request(app)[method](url);
  return body === undefined ? req : req.send(body);
}

const manual = { type: "manual", date: "2026-05-25" };
const busy = {
  type: "busy_block",
  date: "2026-05-21",
  start: "2026-05-21T09:00:00Z",
  end: "2026-05-21T10:00:00Z",
};

describe("path traversal", () => {
  it.each<BadRequest>([
    ["POST with project '../etc'", "post", "/api/time/append", { project: "../etc", entry: { ...manual, minutes: 10 } }],
    ["POST with project 'metro/sub'", "post", "/api/time/append", { project: "metro/sub", entry: { ...manual, minutes: 10 } }],
    ["POST with empty project", "post", "/api/time/append", { project: "", entry: { ...manual, minutes: 10 } }],
    ["GET /today with project '..'", "get", "/api/time/today?project=.."],
    ["GET /range with backslash in project", "get", "/api/time/range?project=metro%5Cbad&from=2026-05-01&to=2026-05-31"],
    ["PATCH with project '..'", "patch", "/api/time/entry/any", { project: "..", patch: { minutes: 60 } }],
    ["DELETE with project '../foo'", "delete", "/api/time/entry/any?project=" + encodeURIComponent("../foo")],
  ])("%s returns 400", async (_label, method, url, body) => {
    const r = await send(method, url, body);
    expect(r.status).toBe(400);
  });
});

describe("request validation", () => {
  it.each<BadRequest>([
    ["POST /append rejects missing project", "post", "/api/time/append", { entry: { type: "manual" } }],
    ["POST /append rejects unknown entry types", "post", "/api/time/append", { project: "metro", entry: { type: "evil" } }],
    ["POST /append rejects manual entry with negative minutes", "post", "/api/time/append", { project: "metro", entry: { ...manual, minutes: -5 } }],
    ["POST /append rejects manual entry with string minutes", "post", "/api/time/append", { project: "metro", entry: { ...manual, minutes: "90" } }],
    ["POST /append rejects manual entry with NaN minutes", "post", "/api/time/append", { project: "metro", entry: { ...manual, minutes: NaN } }],
    ["POST /append rejects manual entry without minutes", "post", "/api/time/append", { project: "metro", entry: manual }],
    ["POST /append rejects busy_block with minutes >= 24h", "post", "/api/time/append", { project: "metro", entry: { ...busy, minutes: 24 * 60 } }],
    ["GET /range 400s on missing params", "get", "/api/time/range?project=metro"],
    ["PATCH 400 when project is missing", "patch", "/api/time/entry/any", { patch: {} }],
    ["DELETE 400 when project is missing", "delete", "/api/time/entry/any"],
  ])("%s", async (_label, method, url, body) => {
    const r = await send(method, url, body);
    expect(r.status).toBe(400);
  });

  it("POST /append accepts busy_block with valid minutes", async () => {
    const r = await request(app).post("/api/time/append").send({
      project: "metro",
      entry: { ...busy, minutes: 60 },
    });
    expect(r.status).toBe(200);
  });
});
