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
  isValidRoot: (root: string) =>
    ["skills", "claude-commands", "opencode-commands", "projects"].includes(root),
  resolveRoot: (root: string) => {
    if (root === "skills") return join(tmpRoot, "skills");
    if (root === "claude-commands") return join(tmpRoot, ".claude", "commands");
    if (root === "opencode-commands") return join(tmpRoot, ".opencode", "commands");
    return join(tmpRoot, "projects");
  },
}));

import filesRouter from "../files";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/files", filesRouter);
  return app;
}

describe("GET /api/files/read?root=<id>", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-read-cross-root-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(join(tmpRoot, "skills", "memo"), { recursive: true });
    writeFileSync(join(tmpRoot, "skills", "memo", "EXTRA.md"), "extra notes\n");
    mkdirSync(join(tmpRoot, ".claude", "commands"), { recursive: true });
    writeFileSync(join(tmpRoot, ".claude", "commands", "memo.md"), "claude memo\n");
    mkdirSync(join(tmpRoot, "projects", "notes"), { recursive: true });
    writeFileSync(join(tmpRoot, "projects", "notes", "secret.md"), "secret content\n");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reads a skill file via ?root=skills", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/files/read/memo/EXTRA.md?root=skills");
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("extra notes");
  });

  it("reads a claude command via ?root=claude-commands", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/files/read/memo.md?root=claude-commands");
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("claude memo");
  });

  it("blocks path traversal across roots", async () => {
    const app = makeApp();
    const res = await request(app).get(
      "/api/files/read/..%2Fprojects%2Fnotes%2Fsecret.md?root=skills"
    );
    expect(res.status).toBe(403);
  });
});
