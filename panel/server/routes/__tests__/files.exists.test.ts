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

import filesRouter from "../files";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/files", filesRouter);
  return app;
}

describe("POST /api/files/exists", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-exists-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "pavilio", "progress"), { recursive: true });
    writeFileSync(join(projectsDir, "pavilio", "progress", "a.md"), "# a");
    writeFileSync(join(tmpRoot, "secret.md"), "outside");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reports each path as present or missing", async () => {
    const res = await request(makeApp())
      .post("/api/files/exists")
      .send({ paths: ["pavilio/progress/a.md", "pavilio/progress/b.md", "pavilio/progress"] });
    expect(res.status).toBe(200);
    expect(res.body.exists).toEqual({
      "pavilio/progress/a.md": true,
      "pavilio/progress/b.md": false,
      "pavilio/progress": false, // a directory is not a file
    });
  });

  it("reports a path outside projectsDir as missing", async () => {
    const res = await request(makeApp())
      .post("/api/files/exists")
      .send({ paths: ["../secret.md", "/etc/passwd"] });
    expect(res.status).toBe(200);
    expect(res.body.exists).toEqual({ "../secret.md": false, "/etc/passwd": false });
  });

  it("rejects a body without a string array", async () => {
    const res = await request(makeApp()).post("/api/files/exists").send({ paths: "x" });
    expect(res.status).toBe(400);
  });
});
