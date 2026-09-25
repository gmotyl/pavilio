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

describe("file-index indexed extensions", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "fidx-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("indexes an .html file under a project", () => {
    seed("alpha/mockups/x.html");
    rebuildIndex();
    const entry = getFileIndex().find(
      (e) => e.relativePath === "alpha/mockups/x.html",
    );
    expect(entry).toMatchObject({ project: "alpha", archived: false });
    expect(entry?.modified).toBeGreaterThan(0);
  });

  it("still skips .css and .js files", () => {
    seed("alpha/mockups/x.css");
    seed("alpha/mockups/x.js");
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).not.toContain("alpha/mockups/x.css");
    expect(paths).not.toContain("alpha/mockups/x.js");
  });

  it("still indexes .md, .txt and .json", () => {
    seed("alpha/notes/a.md");
    seed("alpha/notes/b.txt");
    seed("alpha/_index.json");
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).toContain("alpha/notes/a.md");
    expect(paths).toContain("alpha/notes/b.txt");
    expect(paths).toContain("alpha/_index.json");
  });
});
