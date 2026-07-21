import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { synthesizeAddDiff } from "../git";

let repoDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: repoDir }),
}));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));
vi.mock("../../lib/syncRepo", () => ({ syncRepo: vi.fn() }));
vi.mock("../../lib/hostname", () => ({ machineHostname: () => "test-host" }));

import gitRouter from "../git";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/git", gitRouter);
  return app;
}

function sh(cmd: string) {
  execSync(cmd, { cwd: repoDir, stdio: "pipe" });
}

describe("GET /api/git/status", () => {
  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "gitstatus-"));
    sh("git init -q");
    sh("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init");
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it("lists each file inside an untracked directory individually (-uall)", async () => {
    mkdirSync(join(repoDir, "newdir"));
    writeFileSync(join(repoDir, "newdir", "a.txt"), "a");
    writeFileSync(join(repoDir, "newdir", "b.txt"), "b");

    const res = await request(makeApp()).get(
      `/api/git/status?repo=${encodeURIComponent(repoDir)}`,
    );
    expect(res.status).toBe(200);
    const paths = res.body.map((f: { path: string }) => f.path);
    expect(paths).toContain("newdir/a.txt");
    expect(paths).toContain("newdir/b.txt");
    // no collapsed "dir/" entries
    expect(paths.some((p: string) => p.endsWith("/"))).toBe(false);
  });
});

describe("synthesizeAddDiff", () => {
  it("renders every content line as an add line", () => {
    const out = synthesizeAddDiff("foo.ts", "alpha\nbeta\ngamma\n");
    expect(out).toContain("diff --git a/foo.ts b/foo.ts");
    expect(out).toContain("new file mode 100644");
    expect(out).toContain("--- /dev/null");
    expect(out).toContain("+++ b/foo.ts");
    expect(out).toContain("@@ -0,0 +1,3 @@");
    expect(out).toContain("+alpha");
    expect(out).toContain("+beta");
    expect(out).toContain("+gamma");
  });

  it("omits the trailing-newline empty line from the hunk count", () => {
    const withTrailing = synthesizeAddDiff("a", "one\ntwo\n");
    const withoutTrailing = synthesizeAddDiff("a", "one\ntwo");
    expect(withTrailing).toContain("@@ -0,0 +1,2 @@");
    expect(withoutTrailing).toContain("@@ -0,0 +1,2 @@");
  });

  it("handles empty content as a zero-line hunk", () => {
    const out = synthesizeAddDiff("empty", "");
    expect(out).toContain("@@ -0,0 +1,0 @@");
  });

  it("preserves path in the diff header", () => {
    const out = synthesizeAddDiff("nested/path/file.tsx", "x");
    expect(out).toContain("diff --git a/nested/path/file.tsx b/nested/path/file.tsx");
    expect(out).toContain("+++ b/nested/path/file.tsx");
  });
});
