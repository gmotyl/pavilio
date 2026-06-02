import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));
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

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-write-test-"));
  projectsDir = join(tmpRoot, "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/files/write", () => {
  it("writes a new file, creating parent dirs", async () => {
    const res = await request(makeApp())
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "# rules\n" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.path).toBe("ch/qa/REVIEW_RULES.md");
    expect(readFileSync(join(projectsDir, "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("# rules\n");
  });

  it("overwrites an existing file", async () => {
    mkdirSync(join(projectsDir, "ch/qa"), { recursive: true });
    writeFileSync(join(projectsDir, "ch/qa/REVIEW_RULES.md"), "old");
    const res = await request(makeApp())
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "new" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(projectsDir, "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("new");
  });

  it("rejects path traversal", async () => {
    const res = await request(makeApp())
      .post("/api/files/write")
      .send({ path: "../etc/evil.md", content: "x" });
    expect(res.status).toBe(403);
    expect(existsSync(join(tmpRoot, "etc/evil.md"))).toBe(false);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(makeApp()).post("/api/files/write").send({ path: "ch/x.md" });
    expect(res.status).toBe(400);
  });

  it("accepts empty-string content", async () => {
    const res = await request(makeApp())
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(projectsDir, "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("");
  });

  it("returns 500 when the filesystem write fails", async () => {
    // `ch/qa` is a regular file, so mkdir of it (as a dir) fails with ENOTDIR.
    mkdirSync(join(projectsDir, "ch"), { recursive: true });
    writeFileSync(join(projectsDir, "ch/qa"), "i am a file");
    const res = await request(makeApp())
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/write failed/i);
  });
});
