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
    // Positive control: with only skipped extensions seeded, the index is `[]`
    // and the two negative assertions would also hold if the walk never ran.
    seed("alpha/mockups/x.md");
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).toContain("alpha/mockups/x.md");
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

describe("file-index image mockups", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "fidx-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("indexes image files under a mockups directory", () => {
    const files = ["a.svg", "b.png", "c.jpg", "d.jpeg", "e.webp"].map(
      (f) => `p/mockups/${f}`,
    );
    files.forEach(seed);
    seed("archived/q/mockups/sub/f.png");
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    for (const f of files) expect(paths).toContain(f);
    expect(paths).toContain("archived/q/mockups/sub/f.png");
  });

  it("indexes upper-case image extensions under a mockups directory", () => {
    const files = ["A.PNG", "B.SVG", "C.JPEG", "D.WebP"].map((f) => `p/mockups/${f}`);
    files.forEach(seed);
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    for (const f of files) expect(paths).toContain(f);
  });

  it("does not index image files outside mockups", () => {
    seed("p/notes/shot.png");
    seed("p/notes/diagram.svg");
    seed("p/mockups-old.png");
    // Positive control: proves the walk ran over p/notes
    seed("p/notes/a.md");
    rebuildIndex();
    const paths = getFileIndex().map((e) => e.relativePath);
    expect(paths).toContain("p/notes/a.md");
    expect(paths).not.toContain("p/notes/shot.png");
    expect(paths).not.toContain("p/notes/diagram.svg");
    expect(paths).not.toContain("p/mockups-old.png");
  });
});
