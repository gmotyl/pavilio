import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-move-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter, { resolveCollision } from "../files";

describe("resolveCollision", () => {
  it("returns the original name when nothing collides", () => {
    const dir = join(projects.dir(), "alokai");
    mkdirSync(dir, { recursive: true });
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api.md");
    expect(r?.renamed).toBe(false);
  });

  it("appends -1 on first collision", () => {
    const dir = join(projects.dir(), "alokai", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "farmer-api.md"), "existing");
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api-1.md");
    expect(r?.renamed).toBe(true);
  });

  it("walks the suffix chain", () => {
    const dir = join(projects.dir(), "alokai", "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "farmer-api.md"), "a");
    writeFileSync(join(dir, "farmer-api-1.md"), "b");
    writeFileSync(join(dir, "farmer-api-2.md"), "c");
    const r = resolveCollision(dir, "farmer-api.md");
    expect(r?.name).toBe("farmer-api-3.md");
  });

  it("preserves extensions, including names without one", () => {
    const dir = join(projects.dir(), "alokai");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README"), "x");
    const r = resolveCollision(dir, "README");
    expect(r?.name).toBe("README-1");
  });
});

describe("POST /api/files/move", () => {
  function seedFile(rel: string, content = "hello") {
    const abs = join(projects.dir(), rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }
  function seedDir(rel: string) {
    const abs = join(projects.dir(), rel);
    mkdirSync(abs, { recursive: true });
    return abs;
  }

  it("moves a file from project root into a subfolder", async () => {
    seedFile("alokai/farmer-api.md", "content");
    seedDir("alokai/notes");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: "alokai/farmer-api.md",
      to: "alokai/notes/farmer-api.md",
      renamed: false,
    });
    expect(existsSync(join(projects.dir(), "alokai/farmer-api.md"))).toBe(false);
    expect(readFileSync(join(projects.dir(), "alokai/notes/farmer-api.md"), "utf-8")).toBe("content");
  });

  it("supports cross-project moves", async () => {
    seedFile("alokai/farmer-api.md");
    seedDir("metro/notes");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "metro/notes" });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe("metro/notes/farmer-api.md");
  });

  it("appends -1 on collision", async () => {
    seedFile("alokai/farmer-api.md", "new");
    seedDir("alokai/notes");
    seedFile("alokai/notes/farmer-api.md", "existing");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: "alokai/farmer-api.md",
      to: "alokai/notes/farmer-api-1.md",
      renamed: true,
    });
    expect(readFileSync(join(projects.dir(), "alokai/notes/farmer-api.md"), "utf-8")).toBe("existing");
    expect(readFileSync(join(projects.dir(), "alokai/notes/farmer-api-1.md"), "utf-8")).toBe("new");
  });

  it("rejects path traversal in `from`", async () => {
    seedDir("alokai/notes");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "../etc/passwd", to: "alokai/notes" });
    expect(res.status).toBe(403);
  });

  it("rejects path traversal in `to`", async () => {
    seedFile("alokai/farmer-api.md");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "../tmp" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when source is missing", async () => {
    seedDir("alokai/notes");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/ghost.md", to: "alokai/notes" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when source is a directory", async () => {
    seedDir("alokai/sub");
    seedDir("alokai/notes");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/sub", to: "alokai/notes" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when destination directory is missing", async () => {
    seedFile("alokai/farmer-api.md");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/ghosts" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when destination is a file, not a directory", async () => {
    seedFile("alokai/farmer-api.md");
    seedFile("alokai/notes.md");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/farmer-api.md", to: "alokai/notes.md" });
    expect(res.status).toBe(400);
  });

  it("treats same-source-and-destination-dir as a no-op", async () => {
    seedFile("alokai/notes/foo.md");
    const res = await request(makeApp(filesRouter, "/api/files"))
      .post("/api/files/move")
      .send({ from: "alokai/notes/foo.md", to: "alokai/notes" });
    expect(res.status).toBe(200);
    expect(res.body.noop).toBe(true);
    expect(res.body.to).toBe("alokai/notes/foo.md");
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).post("/api/files/move").send({});
    expect(res.status).toBe(400);
  });
});
