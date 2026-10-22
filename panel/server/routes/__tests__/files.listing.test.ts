import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-files-listing-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter from "../files";

describe("GET /api/files/listing", () => {
  beforeEach(() => {
    mkdirSync(join(projects.root(), "skills", "memo"), { recursive: true });
    writeFileSync(join(projects.root(), "skills", "memo", "SKILL.md"), "---\nname: memo\n---\n");
    writeFileSync(join(projects.root(), "skills", "memo", "EXTRA.md"), "extra notes\n");
    mkdirSync(join(projects.root(), ".claude", "commands"), { recursive: true });
    writeFileSync(join(projects.root(), ".claude", "commands", "memo.md"), "claude memo\n");
    mkdirSync(join(projects.root(), ".opencode", "commands"), { recursive: true });
    writeFileSync(join(projects.root(), ".opencode", "commands", "note.md"), "opencode note\n");
  });

  it("lists every file in skills/ (not just SKILL.md)", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const res = await request(app).get("/api/files/listing?root=skills");
    expect(res.status).toBe(200);
    const paths = res.body.map((f: { relativePath: string }) => f.relativePath).sort();
    expect(paths).toContain("memo/SKILL.md");
    expect(paths).toContain("memo/EXTRA.md");
  });

  it("returns 400 for an unknown root", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const res = await request(app).get("/api/files/listing?root=bogus");
    expect(res.status).toBe(400);
  });

  it("lists .claude/commands and .opencode/commands when present", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const cc = await request(app).get("/api/files/listing?root=claude-commands");
    expect(cc.status).toBe(200);
    expect(cc.body.map((f: { relativePath: string }) => f.relativePath)).toContain("memo.md");

    const oc = await request(app).get("/api/files/listing?root=opencode-commands");
    expect(oc.status).toBe(200);
    expect(oc.body.map((f: { relativePath: string }) => f.relativePath)).toContain("note.md");
  });
});

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
