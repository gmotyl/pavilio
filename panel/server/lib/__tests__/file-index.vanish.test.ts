import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";
// Directory whose readdir throws `failCode` — set per test, empty = real fs.
let failDir = "";
let failCode = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    readdirSync: ((path: fs.PathLike, opts?: unknown) => {
      if (failDir && String(path) === failDir) {
        throw Object.assign(new Error(`${failCode}: ${String(path)}`), { code: failCode });
      }
      return (actual.readdirSync as (p: fs.PathLike, o?: unknown) => unknown)(path, opts);
    }) as typeof actual.readdirSync,
  };
});

import { rebuildIndex, getFileIndex } from "../file-index";

function seed(rel: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "x");
}

// An agent's `rm -rf` of a project runs while the watcher is still rebuilding
// the index; the walk then meets entries readdir listed a moment earlier.
describe("file-index paths that vanish mid-walk", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "fidx-vanish-"));
    failDir = "";
    failCode = "";
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("skips a file that is gone by the time it is stat'ed", () => {
    seed("alpha/notes/kept.md");
    // A dangling symlink is listed by readdir but stat fails with ENOENT —
    // the same state as a file deleted between the two calls.
    symlinkSync(join(projectsDir, "nowhere.md"), join(projectsDir, "alpha/notes/gone.md"));

    expect(() => rebuildIndex()).not.toThrow();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).toContain("alpha/notes/kept.md");
    expect(paths).not.toContain("alpha/notes/gone.md");
  });

  it("skips a directory that is gone by the time it is read", () => {
    seed("alpha/notes/kept.md");
    seed("doomed/wiki/page.md");
    failDir = join(projectsDir, "doomed");
    failCode = "ENOENT";

    expect(() => rebuildIndex()).not.toThrow();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).toEqual(["alpha/notes/kept.md"]);
  });

  it("still throws on errors other than a vanished path", () => {
    seed("alpha/notes/kept.md");
    failDir = join(projectsDir, "alpha");
    failCode = "EACCES";

    expect(() => rebuildIndex()).toThrow(/EACCES/);
  });
});
