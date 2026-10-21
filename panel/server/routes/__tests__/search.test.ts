import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("grep-");

vi.mock("../../config", () => configMock(() => projects.dir()));

import searchRouter from "../search";
import { rebuildIndex } from "../../lib/file-index";

function seed(rel: string, content: string) {
  const abs = join(projects.dir(), rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("grep includeArchived", () => {
  beforeEach(() => {
    seed("alpha/notes/a.md", "needle in active project");
    seed("archived/beta/notes/b.md", "needle in archived project");
    rebuildIndex();
  });

  it("includes archived matches by default", async () => {
    const res = await request(makeApp(searchRouter, "/api/search")).get("/api/search/grep?q=needle");
    const paths = res.body.map((r: { relativePath: string }) => r.relativePath).sort();
    expect(paths).toEqual(["alpha/notes/a.md", "archived/beta/notes/b.md"]);
  });

  it("excludes archived matches when includeArchived=false", async () => {
    const res = await request(makeApp(searchRouter, "/api/search")).get(
      "/api/search/grep?q=needle&includeArchived=false",
    );
    const paths = res.body.map((r: { relativePath: string }) => r.relativePath);
    expect(paths).toEqual(["alpha/notes/a.md"]);
  });
});
