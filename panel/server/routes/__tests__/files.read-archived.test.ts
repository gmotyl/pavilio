import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-files-read-archived-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter from "../files";

describe("GET /api/files/read for archived projects", () => {
  beforeEach(() => {
    mkdirSync(join(projects.dir(), "archived", "metro", "wiki", "sources"), { recursive: true });
    writeFileSync(join(projects.dir(), "archived", "metro", "wiki", "sources", "x.md"), "archived x\n");
    writeFileSync(join(projects.root(), "secret.md"), "outside\n");
  });

  it("read route serves an archived file for a project path", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/read/metro/wiki/sources/x.md");
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("archived x\n");
    expect(res.body.absolutePath).toBe(join(projects.dir(), "archived", "metro", "wiki", "sources", "x.md"));
  });

  it("prefers the active project over the archived copy", async () => {
    mkdirSync(join(projects.dir(), "metro", "wiki", "sources"), { recursive: true });
    writeFileSync(join(projects.dir(), "metro", "wiki", "sources", "x.md"), "active x\n");
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/read/metro/wiki/sources/x.md");
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("active x\n");
  });

  it("still refuses a path escaping the projects dir", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/read/..%2F..%2Fsecret.md");
    expect(res.status).toBe(403);
  });
});
