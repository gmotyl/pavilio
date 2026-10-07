import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));
vi.mock("../../lib/file-index", () => ({
  getFileIndex: () => [],
  rebuildIndex: vi.fn(),
}));
vi.mock("../../lib/file-roots", () => ({
  isValidRoot: (root: string) => root === "skills",
  resolveRoot: () => join(tmpRoot, "skills"),
}));

import filesRouter from "../files";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/files", filesRouter);
  return app;
}

describe("GET /api/files/read?meta=1", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-read-meta-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "pavilio", "mockups"), { recursive: true });
    writeFileSync(
      join(projectsDir, "pavilio", "mockups", "hero.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]),
    );
    mkdirSync(join(tmpRoot, "skills"), { recursive: true });
    writeFileSync(join(tmpRoot, "skills", "x.png"), Buffer.from([0xff, 0xfe]));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns the absolute path without the content", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/hero.png?meta=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.absolutePath).toBe(
      join(projectsDir, "pavilio", "mockups", "hero.png"),
    );
    expect(res.body.content).toBe("");
  });

  it("returns no content for a cross-root meta read either", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/x.png?root=skills&meta=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.absolutePath).toBe(join(tmpRoot, "skills", "x.png"));
    expect(res.body.content).toBe("");
  });

  it("still 404s a missing file", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/nope.png?meta=1",
    );
    expect(res.status).toBe(404);
  });

  it("still returns the content without meta", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/hero.png",
    );
    expect(res.status).toBe(200);
    expect(res.body.content.length).toBeGreaterThan(0);
  });
});
