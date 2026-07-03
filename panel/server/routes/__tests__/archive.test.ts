import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import archiveRouter from "../archive";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/archive", archiveRouter);
  return app;
}

function seedProject(rel: string) {
  mkdirSync(join(projectsDir, rel), { recursive: true });
  writeFileSync(join(projectsDir, rel, "PROJECT.md"), `# ${rel}`);
}

describe("archive routes", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "arch-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("archives a project by moving it to archived/", async () => {
    seedProject("alpha");
    const res = await request(makeApp()).post("/api/archive/alpha");
    expect(res.status).toBe(200);
    expect(existsSync(join(projectsDir, "archived", "alpha", "PROJECT.md"))).toBe(true);
    expect(existsSync(join(projectsDir, "alpha"))).toBe(false);
  });

  it("404s on unknown project", async () => {
    const res = await request(makeApp()).post("/api/archive/nope");
    expect(res.status).toBe(404);
  });

  it("409s when archived target already exists", async () => {
    seedProject("alpha");
    seedProject("archived/alpha");
    const res = await request(makeApp()).post("/api/archive/alpha");
    expect(res.status).toBe(409);
    expect(existsSync(join(projectsDir, "alpha"))).toBe(true);
  });

  it("rejects path traversal names", async () => {
    for (const bad of ["..", "a%2Fb", "a%5Cb", "%2E%2E%2Fetc"]) {
      const res = await request(makeApp()).post(`/api/archive/${bad}`);
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
    expect(existsSync(join(projectsDir, "archived"))).toBe(false);
  });

  it("restores an archived project", async () => {
    seedProject("archived/beta");
    const res = await request(makeApp()).post("/api/archive/beta/restore");
    expect(res.status).toBe(200);
    expect(existsSync(join(projectsDir, "beta", "PROJECT.md"))).toBe(true);
    expect(existsSync(join(projectsDir, "archived", "beta"))).toBe(false);
  });

  it("409s restoring onto an existing active project", async () => {
    seedProject("beta");
    seedProject("archived/beta");
    const res = await request(makeApp()).post("/api/archive/beta/restore");
    expect(res.status).toBe(409);
  });

  it("lists archived projects with archivedAt", async () => {
    seedProject("archived/beta");
    seedProject("archived/gamma");
    const res = await request(makeApp()).get("/api/archive");
    expect(res.status).toBe(200);
    const names = res.body.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(["beta", "gamma"]);
    expect(typeof res.body[0].archivedAt).toBe("string");
  });

  it("returns [] when archived/ does not exist", async () => {
    const res = await request(makeApp()).get("/api/archive");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
