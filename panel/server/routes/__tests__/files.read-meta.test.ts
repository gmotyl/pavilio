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

describe("GET /api/files/read?maxBytes=", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-read-max-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "pavilio", "mockups"), { recursive: true });
    writeFileSync(join(projectsDir, "pavilio", "mockups", "big.svg"), "<svg>" + "x".repeat(64) + "</svg>");
    mkdirSync(join(tmpRoot, "skills"), { recursive: true });
    writeFileSync(join(tmpRoot, "skills", "big.svg"), "<svg>" + "x".repeat(64) + "</svg>");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns no content, flagged, for a file over the cap", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=16",
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      absolutePath: join(projectsDir, "pavilio", "mockups", "big.svg"),
      content: "",
      tooLarge: true,
    });
  });

  it("applies the cap to a cross-root read too", async () => {
    const res = await request(makeApp()).get("/api/files/read/big.svg?root=skills&maxBytes=16");
    expect(res.body).toMatchObject({ content: "", tooLarge: true });
  });

  it("returns the content of a file under the cap", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=4096",
    );
    expect(res.body.content).toMatch(/^<svg>/);
    expect(res.body.tooLarge).toBeUndefined();
  });

  it("ignores a malformed cap", async () => {
    const res = await request(makeApp()).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=lots",
    );
    expect(res.body.content).toMatch(/^<svg>/);
  });
});
