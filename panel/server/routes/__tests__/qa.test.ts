import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import http from "http";
import type { AddressInfo } from "net";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-qa-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));

// Every process-spawning entry point, wrapped so a delete that shells out
// (e.g. `git rm`) is caught. Both specifiers resolve to the same module.
const { spawned, wrapChildProcess } = vi.hoisted(() => {
  const spawned = { calls: [] as unknown[][] };
  const wrapChildProcess = (actual: Record<string, unknown>) => {
    const wrapped: Record<string, unknown> = { ...actual };
    for (const fn of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      const original = actual[fn] as (...args: unknown[]) => unknown;
      wrapped[fn] = (...args: unknown[]) => {
        spawned.calls.push([fn, ...args]);
        return original(...args);
      };
    }
    return { ...wrapped, default: wrapped };
  };
  return { spawned, wrapChildProcess };
});
vi.mock("child_process", async (importOriginal) => wrapChildProcess(await importOriginal()));
vi.mock("node:child_process", async (importOriginal) => wrapChildProcess(await importOriginal()));

import qaRouter from "../qa";

const app = () => makeApp(qaRouter, "/api/projects");
const projectDir = (project = "p") => join(projects.dir(), project);
const qaDir = (project = "p") => join(projectDir(project), "qa");

function seed() {
  mkdirSync(join(qaDir(), "stories", "a"), { recursive: true });
  mkdirSync(join(qaDir(), "reviews"), { recursive: true });
  mkdirSync(join(qaDir(), "runs", "2026-11-20-x", "shots"), { recursive: true });
  writeFileSync(join(projectDir(), "PROJECT.md"), "# p");
  writeFileSync(join(qaDir(), "REVIEW_RULES.md"), "rules");
  writeFileSync(join(qaDir(), "stories", "pavilio-pr-237.md"), "story");
  writeFileSync(join(qaDir(), "stories", ".gitignore"), "*");
  writeFileSync(join(qaDir(), "stories", "a", "b.md"), "nested");
  writeFileSync(join(qaDir(), "reviews", "2026-11-20-review.md"), "review");
  writeFileSync(join(qaDir(), "runs", "2026-11-20-x", "run.md"), "run");
  writeFileSync(join(qaDir(), "runs", "2026-11-20-x", "shots", "1.png"), "png");
}

/** Every file and dir under the project, to prove a refused request changed nothing. */
function tree(dir = projects.dir()): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" }).sort();
}

const del = (path: string) => request(app()).delete(`/api/projects/p/qa/${path}`);

/**
 * DELETE with the path sent byte-for-byte. supertest goes through WHATWG URL,
 * which collapses `..`, `%2e%2e` and `.` segments before the server sees them.
 */
async function rawDel(path: string, project = "p"): Promise<number> {
  const server = app().listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<number>((done, fail) => {
      const req = http.request(
        { host: "127.0.0.1", port, method: "DELETE", path: `/api/projects/${project}/qa/${path}` },
        (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        },
      );
      req.on("error", fail);
      req.end();
    });
  } finally {
    server.close();
  }
}

describe("DELETE /api/projects/:project/qa/*path", () => {
  beforeEach(() => {
    spawned.calls = [];
    seed();
  });

  it("deletes a story file", async () => {
    const res = await del("stories/pavilio-pr-237.md");
    expect(res.status).toBe(204);
    expect(existsSync(join(qaDir(), "stories", "pavilio-pr-237.md"))).toBe(false);
    expect(existsSync(join(qaDir(), "stories", ".gitignore"))).toBe(true);
  });

  it("deletes a review file", async () => {
    const res = await del("reviews/2026-11-20-review.md");
    expect(res.status).toBe(204);
    expect(existsSync(join(qaDir(), "reviews", "2026-11-20-review.md"))).toBe(false);
    expect(existsSync(join(qaDir(), "reviews"))).toBe(true);
  });

  it("deletes a run folder recursively", async () => {
    const res = await del("runs/2026-11-20-x");
    expect(res.status).toBe(204);
    expect(existsSync(join(qaDir(), "runs", "2026-11-20-x"))).toBe(false);
    expect(existsSync(join(qaDir(), "runs"))).toBe(true);
  });

  it("refuses paths outside the three shapes", async () => {
    // A run's file, a symlink escaping qa/, and wrong-kind targets too.
    mkdirSync(join(projectDir(), "outside"), { recursive: true });
    writeFileSync(join(projectDir(), "outside", "x.md"), "outside");
    symlinkSync(join(projectDir(), "outside", "x.md"), join(qaDir(), "stories", "link.md"));
    symlinkSync(join(projectDir(), "outside"), join(qaDir(), "runs", "linked-run"));
    writeFileSync(join(qaDir(), "runs", "not-a-dir"), "file");
    const before = tree();
    for (const path of [
      "REVIEW_RULES.md",
      "runs/2026-11-20-x/run.md",
      "stories/.gitignore",
      "stories/a/b.md",
      "stories/a",
      "stories/notes.txt",
      "reviews/.md",
      "other/x.md",
      "stories",
      "runs",
      "stories/link.md",
      "runs/linked-run",
      "runs/not-a-dir",
    ]) {
      const res = await del(path);
      expect(res.status, path).toBe(400);
    }
    expect(tree()).toEqual(before);
  });

  it("refuses traversal", async () => {
    const before = tree();
    for (const path of [
      "stories/..",
      "runs/../stories",
      "stories/../../PROJECT.md",
      "stories/%2e%2e",
      "runs/%2E%2E",
      "runs/..%2F..",
      "stories/..%2F..%2FPROJECT.md",
      "stories/%2e%2e%2fREVIEW_RULES.md",
      "reviews/..%5C..%5CPROJECT.md",
      "runs/.",
      "runs/%2e",
    ]) {
      expect(await rawDel(path), path).toBe(400);
    }
    expect(tree()).toEqual(before);
    expect(existsSync(join(projectDir(), "PROJECT.md"))).toBe(true);
  });

  it("refuses a target reached through a symlinked parent dir", async () => {
    // qa/reviews -> qa/runs: reviews/a.md would really be runs/a.md.
    rmSync(join(qaDir(), "reviews"), { recursive: true });
    symlinkSync(join(qaDir(), "runs"), join(qaDir(), "reviews"));
    writeFileSync(join(qaDir(), "runs", "a.md"), "not a review");
    const before = tree();
    expect((await del("reviews/a.md")).status).toBe(400);
    expect(existsSync(join(qaDir(), "runs", "a.md"))).toBe(true);
    expect(tree()).toEqual(before);
  });

  it("refuses a symlink inside qa that points inside qa", async () => {
    symlinkSync(join(qaDir(), "REVIEW_RULES.md"), join(qaDir(), "stories", "rules.md"));
    symlinkSync(join(qaDir(), "runs", "2026-11-20-x"), join(qaDir(), "runs", "alias"));
    const before = tree();
    expect((await del("stories/rules.md")).status).toBe(400);
    expect((await del("runs/alias")).status).toBe(400);
    expect(existsSync(join(qaDir(), "REVIEW_RULES.md"))).toBe(true);
    expect(existsSync(join(qaDir(), "runs", "2026-11-20-x", "run.md"))).toBe(true);
    expect(tree()).toEqual(before);
  });

  it("refuses an encoded .. project name", async () => {
    const before = tree();
    for (const project of ["%2e%2e", "%2E%2E", "..%2Fp", "%2e%2e%2fp"]) {
      expect(await rawDel("stories/pavilio-pr-237.md", project), project).toBe(400);
    }
    expect(tree()).toEqual(before);
  });

  it("404 for a missing target", async () => {
    expect((await del("stories/nope.md")).status).toBe(404);
    expect((await del("reviews/nope.md")).status).toBe(404);
    expect((await del("runs/2026-01-01-nope")).status).toBe(404);
    const unknown = await request(app()).delete("/api/projects/ghost/qa/stories/x.md");
    expect(unknown.status).toBe(404);
  });

  it("runs no git command", async () => {
    expect((await del("stories/pavilio-pr-237.md")).status).toBe(204);
    expect((await del("reviews/2026-11-20-review.md")).status).toBe(204);
    expect((await del("runs/2026-11-20-x")).status).toBe(204);
    expect(spawned.calls).toEqual([]);
  });
});
