import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-exists-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter from "../files";

describe("POST /api/files/exists", () => {
  beforeEach(() => {
    const projectsDir = projects.dir();
    mkdirSync(join(projectsDir, "pavilio", "progress"), { recursive: true });
    writeFileSync(join(projectsDir, "pavilio", "progress", "a.md"), "# a");
    writeFileSync(join(projects.root(), "secret.md"), "outside");
  });

  it("reports each path as present or missing", async () => {
    const res = await request(makeApp(filesRouter, "/api/files"))
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
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/exists")
      .send({ paths: ["../secret.md", "/etc/passwd"] });
    expect(res.status).toBe(200);
    expect(res.body.exists).toEqual({ "../secret.md": false, "/etc/passwd": false });
  });

  it("rejects a body without a string array", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).post("/api/files/exists").send({ paths: "x" });
    expect(res.status).toBe(400);
  });
});
