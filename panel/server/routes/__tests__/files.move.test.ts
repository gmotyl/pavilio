import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));
vi.mock("../../lib/file-index", () => ({
  getFileIndex: () => [],
  rebuildIndex: vi.fn(),
}));

import filesRouter, { resolveCollision } from "../files";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/files", filesRouter);
  return app;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-move-test-"));
  projectsDir = join(tmpRoot, "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveCollision", () => {
  it("returns the original name when nothing collides", () => {
    const dir = join(projectsDir, "alokai");
    mkdirSync(dir, { recursive: true });
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api.md");
    expect(r?.renamed).toBe(false);
  });

  it("appends -1 on first collision", () => {
    const dir = join(projectsDir, "alokai", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "farmer-api.md"), "existing");
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api-1.md");
    expect(r?.renamed).toBe(true);
  });

  it("walks the suffix chain", () => {
    const dir = join(projectsDir, "alokai", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "farmer-api.md"), "a");
    writeFileSync(join(dir, "farmer-api-1.md"), "b");
    writeFileSync(join(dir, "farmer-api-2.md"), "c");
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api-3.md");
  });

  it("preserves extensions, including names without one", () => {
    const dir = join(projectsDir, "alokai");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README"), "x");
    const r = resolveCollision(dir, "README");
    expect(r?.name).toBe("README-1");
  });
});

describe("POST /api/files/move", () => {
  function seedFile(rel: string, content = "hello") {
    const abs = join(projectsDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }
  function seedDir(rel: string) {
    const abs = join(projectsDir, rel);
    mkdirSync(abs, { recursive: true });
    return abs;
  }

  it("moves a file from project root into a subfolder", async () => {
    seedFile("alokai/farmer-api.md", "content");
    seedDir("alokai/notes");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: "alokai/farmer-api.md",
      to: "alokai/notes/farmer-api.md",
      renamed: false,
    });
    expect(existsSync(join(projectsDir, "alokai/farmer-api.md"))).toBe(false);
    expect(readFileSync(join(projectsDir, "alokai/notes/farmer-api.md"), "utf-8")).toBe("content");
  });

  it("supports cross-project moves", async () => {
    seedFile("alokai/farmer-api.md");
    seedDir("metro/notes");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "metro/notes" });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe("metro/notes/farmer-api.md");
  });

  it("appends -1 on collision", async () => {
    seedFile("alokai/farmer-api.md", "new");
    seedDir("alokai/notes");
    seedFile("alokai/notes/farmer-api.md", "existing");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: "alokai/farmer-api.md",
      to: "alokai/notes/farmer-api-1.md",
      renamed: true,
    });
    expect(readFileSync(join(projectsDir, "alokai/notes/farmer-api.md"), "utf-8")).toBe("existing");
    expect(readFileSync(join(projectsDir, "alokai/notes/farmer-api-1.md"), "utf-8")).toBe("new");
  });

  it("rejects path traversal in `from`", async () => {
    seedDir("alokai/notes");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "../etc/passwd", to: "alokai/notes" });
    expect(res.status).toBe(403);
  });

  it("rejects path traversal in `to`", async () => {
    seedFile("alokai/farmer-api.md");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "../tmp" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when source is missing", async () => {
    seedDir("alokai/notes");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/ghost.md", to: "alokai/notes" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when source is a directory", async () => {
    seedDir("alokai/sub");
    seedDir("alokai/notes");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/sub", to: "alokai/notes" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when destination directory is missing", async () => {
    seedFile("alokai/farmer-api.md");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/ghosts" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when destination is a file, not a directory", async () => {
    seedFile("alokai/farmer-api.md");
    seedFile("alokai/notes.md");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes.md" });
    expect(res.status).toBe(400);
  });

  it("treats same-source-and-destination-dir as a no-op", async () => {
    seedFile("alokai/notes/foo.md");
    const res = await request(makeApp())
      .post("/api/files/move")
      .send({ from: "alokai/notes/foo.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body.noop).toBe(true);
    expect(res.body.to).toBe("alokai/notes/foo.md");
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(makeApp()).post("/api/files/move").send({});
    expect(res.status).toBe(400);
  });
});
