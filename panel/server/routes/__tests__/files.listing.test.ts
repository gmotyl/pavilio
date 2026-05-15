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

describe("GET /api/files/listing", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-listing-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(join(tmpRoot, "skills", "memo"), { recursive: true });
    writeFileSync(join(tmpRoot, "skills", "memo", "SKILL.md"), "---\nname: memo\n---\n");
    writeFileSync(join(tmpRoot, "skills", "memo", "EXTRA.md"), "extra notes\n");
    mkdirSync(join(tmpRoot, ".claude", "commands"), { recursive: true });
    writeFileSync(join(tmpRoot, ".claude", "commands", "memo.md"), "claude memo\n");
    mkdirSync(join(tmpRoot, ".opencode", "commands"), { recursive: true });
    writeFileSync(join(tmpRoot, ".opencode", "commands", "note.md"), "opencode note\n");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("lists every file in skills/ (not just SKILL.md)", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/files/listing?root=skills");
    expect(res.status).toBe(200);
    const paths = res.body.map((f: { relativePath: string }) => f.relativePath).sort();
    expect(paths).toContain("memo/SKILL.md");
    expect(paths).toContain("memo/EXTRA.md");
  });

  it("returns 400 for an unknown root", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/files/listing?root=bogus");
    expect(res.status).toBe(400);
  });

  it("lists .claude/commands and .opencode/commands when present", async () => {
    const app = makeApp();
    const cc = await request(app).get("/api/files/listing?root=claude-commands");
    expect(cc.status).toBe(200);
    expect(cc.body.map((f: { relativePath: string }) => f.relativePath)).toContain("memo.md");

    const oc = await request(app).get("/api/files/listing?root=opencode-commands");
    expect(oc.status).toBe(200);
    expect(oc.body.map((f: { relativePath: string }) => f.relativePath)).toContain("note.md");
  });
});
