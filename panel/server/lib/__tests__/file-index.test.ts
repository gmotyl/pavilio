import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import { rebuildIndex, getFileIndex } from "../file-index";

function seed(rel: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "x");
}

describe("file-index archived flag", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "fidx-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("flags entries under archived/ and reports the real project name", () => {
    seed("alpha/notes/a.md");
    seed("archived/beta/notes/b.md");
    rebuildIndex();
    const idx = getFileIndex();
    const active = idx.find((e) => e.relativePath === "alpha/notes/a.md");
    const arch = idx.find((e) => e.relativePath === "archived/beta/notes/b.md");
    expect(active).toMatchObject({ project: "alpha", archived: false });
    expect(arch).toMatchObject({ project: "beta", archived: true });
  });
});
