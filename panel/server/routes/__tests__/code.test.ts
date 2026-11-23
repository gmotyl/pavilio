import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { execFileSync } from "child_process";
import { mkdirSync, realpathSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";
import type { TsNav } from "../../lib/ts-nav";
import { gitSafeEnv } from "../../lib/gitEnv";

const projects = withProjectsDir("code-route-");
vi.mock("../../config", () => configMock(() => projects.dir()));

import { createCodeRouter } from "../code";

function setup() {
  const repo = join(projects.root(), "repo");
  mkdirSync(repo);
  const dir = join(projects.dir(), "proj");
  mkdirSync(dir);
  writeFileSync(join(dir, "PROJECT.md"), "# proj\n");
  writeFileSync(join(dir, "repos.json"), JSON.stringify([{ name: "repo", path: repo }]));
  const nav = {
    definition: vi.fn(async () => [{ path: "src/a.ts", line: 1, col: 1 }]),
    activeRoots: () => [],
    dispose: () => {},
  } satisfies TsNav;
  return { repo, nav, app: makeApp(createCodeRouter(nav), "/api/code") };
}

describe("/api/code/definition", () => {
  it("answers the definitions for a linked repo", async () => {
    const { repo, nav, app } = setup();
    const res = await request(app).get("/api/code/definition").query({ repo, path: "src/b.ts", line: "3", col: "7" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locations: [{ path: "src/a.ts", line: 1, col: 1 }] });
    expect(nav.definition).toHaveBeenCalledWith(repo, "src/b.ts", 3, 7);
  });

  it("answers for the main checkout when the project links one of its secondary worktrees", async () => {
    const { nav, app } = setup();
    const main = join(realpathSync(projects.root()), "main");
    const wt = join(realpathSync(projects.root()), "main-wt");
    mkdirSync(main);
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: main, env: gitSafeEnv(), stdio: "pipe" });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "base");
    git("worktree", "add", "-q", "-b", "side", wt);
    writeFileSync(join(projects.dir(), "proj", "repos.json"), JSON.stringify([{ name: "repo", path: wt }]));

    const res = await request(app).get("/api/code/definition").query({ repo: main, path: "src/b.ts", line: "3", col: "7" });
    expect(res.status).toBe(200);
    expect(nav.definition).toHaveBeenCalledWith(main, "src/b.ts", 3, 7);
  });

  it("rejects an unlinked repo, an escaping path and a bad position", async () => {
    const { repo, nav, app } = setup();
    for (const q of [
      { repo: "/somewhere/else", path: "a.ts", line: "1", col: "1" },
      { repo, path: "../outside.ts", line: "1", col: "1" },
      { repo, path: "/etc/a.ts", line: "1", col: "1" },
      { repo, path: "a.ts", line: "0", col: "1" },
      { repo, path: "a.ts", line: "1", col: "x" },
    ]) {
      const res = await request(app).get("/api/code/definition").query(q);
      expect(res.status).toBe(400);
    }
    expect(nav.definition).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("passes a POSIX backslash filename through literally", async () => {
    const { repo, nav, app } = setup();
    const res = await request(app).get("/api/code/definition").query({ repo, path: "src/a\\b.ts", line: "1", col: "1" });
    expect(res.status).toBe(200);
    expect(nav.definition).toHaveBeenCalledWith(repo, "src/a\\b.ts", 1, 1);
  });
});
