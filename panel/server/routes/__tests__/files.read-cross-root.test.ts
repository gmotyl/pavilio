import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-read-cross-root-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());
vi.mock("../../lib/file-roots", () => ({
  isValidRoot: (root: string) =>
    ["skills", "claude-commands", "opencode-commands", "projects"].includes(root),
  resolveRoot: (root: string) => {
    if (root === "skills") return join(projects.root(), "skills");
    if (root === "claude-commands") return join(projects.root(), ".claude", "commands");
    if (root === "opencode-commands") return join(projects.root(), ".opencode", "commands");
    return join(projects.root(), "projects");
  },
}));

import filesRouter from "../files";

describe("GET /api/files/read?root=<id>", () => {
  beforeEach(() => {
    mkdirSync(join(projects.root(), "skills", "memo"), { recursive: true });
    writeFileSync(join(projects.root(), "skills", "memo", "EXTRA.md"), "extra notes\n");
    mkdirSync(join(projects.root(), ".claude", "commands"), { recursive: true });
    writeFileSync(join(projects.root(), ".claude", "commands", "memo.md"), "claude memo\n");
    mkdirSync(join(projects.root(), "projects", "notes"), { recursive: true });
    writeFileSync(join(projects.root(), "projects", "notes", "secret.md"), "secret content\n");
  });

  it("reads a skill file via ?root=skills", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const res = await request(app).get("/api/files/read/memo/EXTRA.md?root=skills");
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("extra notes");
  });

  it("reads a claude command via ?root=claude-commands", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const res = await request(app).get("/api/files/read/memo.md?root=claude-commands");
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("claude memo");
  });

  it("blocks path traversal across roots", async () => {
    const app = makeApp(filesRouter, "/api/files");
    const res = await request(app).get(
      "/api/files/read/..%2Fprojects%2Fnotes%2Fsecret.md?root=skills"
    );
    expect(res.status).toBe(403);
  });
});
