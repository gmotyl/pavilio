import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-write-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter from "../files";

describe("POST /api/files/write", () => {
  it("writes a new file, creating parent dirs", async () => {
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "# rules\n" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.path).toBe("ch/qa/REVIEW_RULES.md");
    expect(readFileSync(join(projects.dir(), "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("# rules\n");
  });

  it("overwrites an existing file", async () => {
    mkdirSync(join(projects.dir(), "ch/qa"), { recursive: true });
    writeFileSync(join(projects.dir(), "ch/qa/REVIEW_RULES.md"), "old");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "new" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(projects.dir(), "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("new");
  });

  it("rejects path traversal", async () => {
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/write")
      .send({ path: "../etc/evil.md", content: "x" });
    expect(res.status).toBe(403);
    expect(existsSync(join(projects.root(), "etc/evil.md"))).toBe(false);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).post("/api/files/write").send({ path: "ch/x.md" });
    expect(res.status).toBe(400);
  });

  it("accepts empty-string content", async () => {
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(projects.dir(), "ch/qa/REVIEW_RULES.md"), "utf-8")).toBe("");
  });

  it("returns 500 when the filesystem write fails", async () => {
    // `ch/qa` is a regular file, so mkdir of it (as a dir) fails with ENOTDIR.
    mkdirSync(join(projects.dir(), "ch"), { recursive: true });
    writeFileSync(join(projects.dir(), "ch/qa"), "i am a file");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/write")
      .send({ path: "ch/qa/REVIEW_RULES.md", content: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/write failed/i);
  });
});
