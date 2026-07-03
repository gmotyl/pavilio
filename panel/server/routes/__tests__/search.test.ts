import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import searchRouter from "../search";
import { rebuildIndex } from "../../lib/file-index";

function makeApp() {
  const app = express();
  app.use("/api/search", searchRouter);
  return app;
}

function seed(rel: string, content: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("grep includeArchived", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "grep-"));
    seed("alpha/notes/a.md", "needle in active project");
    seed("archived/beta/notes/b.md", "needle in archived project");
    rebuildIndex();
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("includes archived matches by default", async () => {
    const res = await request(makeApp()).get("/api/search/grep?q=needle");
    const paths = res.body.map((r: { relativePath: string }) => r.relativePath).sort();
    expect(paths).toEqual(["alpha/notes/a.md", "archived/beta/notes/b.md"]);
  });

  it("excludes archived matches when includeArchived=false", async () => {
    const res = await request(makeApp()).get(
      "/api/search/grep?q=needle&includeArchived=false",
    );
    const paths = res.body.map((r: { relativePath: string }) => r.relativePath);
    expect(paths).toEqual(["alpha/notes/a.md"]);
  });
});
