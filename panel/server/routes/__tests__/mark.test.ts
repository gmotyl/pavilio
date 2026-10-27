import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-mark-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));

// Lets a test hold a PUT right after its rename, to interleave two mutations.
const fsGate = vi.hoisted(() => ({
  afterRename: null as null | ((target: string) => Promise<void>),
  beforeUnlink: null as null | ((target: string) => Promise<void>),
}));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) => {
      await actual.rename(from, to);
      await fsGate.afterRename?.(to);
    },
    unlink: async (path: string) => {
      await fsGate.beforeUnlink?.(path);
      await actual.unlink(path);
    },
  };
});

import markRouter from "../mark";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 250, 251]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

const app = () => makeApp(markRouter, "/api/projects");
const projectDir = (project = "p") => join(projects.dir(), project);
const markFiles = (project = "p") =>
  readdirSync(projectDir(project)).filter((f) => f.startsWith("mark.")).sort();

describe("/api/projects/:name/mark", () => {
  beforeEach(() => {
    fsGate.afterRename = null;
    fsGate.beforeUnlink = null;
    mkdirSync(projectDir(), { recursive: true });
    writeFileSync(join(projectDir(), "PROJECT.md"), "# p");
  });

  it("PUT stores mark.png and removes other mark files", async () => {
    writeFileSync(join(projectDir(), "mark.svg"), SVG);
    writeFileSync(join(projectDir(), "mark.webp"), "old");
    const res = await request(app()).put("/api/projects/p/mark").attach("image", PNG, "logo.png");
    expect(res.status).toBe(200);
    expect(res.body.mark).toBe("image:mark.png");
    expect(typeof res.body.hash).toBe("string");
    expect(res.body.hash.length).toBeGreaterThan(0);
    expect(markFiles()).toEqual(["mark.png"]);
    expect(readFileSync(join(projectDir(), "mark.png")).equals(PNG)).toBe(true);
  });

  it("PUT rejects oversize files", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(262144)]);
    const res = await request(app()).put("/api/projects/p/mark").attach("image", big, "big.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(markFiles()).toEqual([]);
  });

  it("PUT accepts an image of exactly 256 KB", async () => {
    const edge = Buffer.concat([PNG, Buffer.alloc(262144 - PNG.length)]);
    expect(edge.length).toBe(262144);
    const res = await request(app()).put("/api/projects/p/mark").attach("image", edge, "edge.png");
    expect(res.status).toBe(200);
    expect(readFileSync(join(projectDir(), "mark.png")).length).toBe(262144);
  });

  it("PUT rejects an image one byte over 256 KB and writes nothing", async () => {
    writeFileSync(join(projectDir(), "mark.svg"), SVG);
    const over = Buffer.concat([PNG, Buffer.alloc(262145 - PNG.length)]);
    expect(over.length).toBe(262145);
    const res = await request(app()).put("/api/projects/p/mark").attach("image", over, "over.png");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
    expect(markFiles()).toEqual(["mark.svg"]);
    expect(readdirSync(projectDir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("PUT rejects unsupported types", async () => {
    writeFileSync(join(projectDir(), "mark.svg"), SVG);
    for (const [buf, name] of [
      [Buffer.from("GIF89a....."), "logo.gif"],
      [Buffer.from("<!doctype html><html></html>"), "logo.png"],
      [Buffer.from("<!doctype html><html></html>"), "page.html"],
    ] as const) {
      const res = await request(app()).put("/api/projects/p/mark").attach("image", buf, name);
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    // A rejected upload leaves the stored mark alone.
    expect(markFiles()).toEqual(["mark.svg"]);
  });

  it("GET serves an SVG mark sandboxed", async () => {
    writeFileSync(join(projectDir(), "mark.svg"), SVG);
    const res = await request(app()).get("/api/projects/p/mark");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  it("GET without a mark is 404", async () => {
    const res = await request(app()).get("/api/projects/p/mark");
    expect(res.status).toBe(404);
  });

  it("DELETE removes the mark and is idempotent", async () => {
    writeFileSync(join(projectDir(), "mark.png"), PNG);
    writeFileSync(join(projectDir(), "mark.svg"), SVG);
    const first = await request(app()).delete("/api/projects/p/mark");
    expect(first.status).toBe(204);
    expect(markFiles()).toEqual([]);
    const second = await request(app()).delete("/api/projects/p/mark");
    expect(second.status).toBe(204);
  });

  it("PUT leaves no temp file behind when the write fails", async () => {
    // A non-empty directory named mark.png makes the rename onto it fail.
    mkdirSync(join(projectDir(), "mark.png", "inner"), { recursive: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app()).put("/api/projects/p/mark").attach("image", PNG, "logo.png");
    expect(res.status).toBe(500);
    expect(readdirSync(projectDir()).filter((f) => f.startsWith(".mark-"))).toEqual([]);
  });

  it("PUT temp names do not collide within one process and millisecond", async () => {
    // A leftover temp from an earlier write in the same pid + ms must not
    // make the exclusive temp write fail.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    writeFileSync(join(projectDir(), `.mark-${process.pid}-1700000000000.tmp`), "stale");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app()).put("/api/projects/p/mark").attach("image", PNG, "logo.png");
    expect(res.status).toBe(200);
    expect(markFiles()).toEqual(["mark.png"]);
  });

  it("unknown project is 404", async () => {
    const put = await request(app()).put("/api/projects/nope/mark").attach("image", PNG, "a.png");
    expect(put.status).toBe(404);
    expect(existsSync(projectDir("nope"))).toBe(false);
    expect((await request(app()).get("/api/projects/nope/mark")).status).toBe(404);
    expect((await request(app()).delete("/api/projects/nope/mark")).status).toBe(404);
    // A traversal name never reaches the filesystem.
    expect((await request(app()).get("/api/projects/..%2F..%2Fetc/mark")).status).toBeGreaterThanOrEqual(400);
  });

  it("concurrent PUTs of different types leave exactly one mark", async () => {
    // Hold the PNG write just after its rename until the SVG write has renamed
    // too (or 300 ms pass): unserialized, each then deletes the other's file.
    let svgRenamed!: () => void;
    const svgDone = new Promise<void>((r) => (svgRenamed = r));
    let pngRenamed!: () => void;
    const pngDone = new Promise<void>((r) => (pngRenamed = r));
    fsGate.afterRename = async (target) => {
      if (target.endsWith("mark.svg")) svgRenamed();
      if (target.endsWith("mark.png")) {
        pngRenamed();
        await Promise.race([svgDone, new Promise((r) => setTimeout(r, 300))]);
      }
    };
    const a = request(app()).put("/api/projects/p/mark").attach("image", PNG, "a.png").then((r) => r);
    await pngDone;
    const b = await request(app()).put("/api/projects/p/mark").attach("image", SVG, "b.svg");
    const first = await a;
    expect(first.status).toBe(200);
    expect(b.status).toBe(200);
    // Arrival order wins: the later PUT's file is the mark.
    expect(markFiles()).toEqual(["mark.svg"]);
  });

  it("a PUT that arrives during a DELETE is not deleted by it", async () => {
    writeFileSync(join(projectDir(), "mark.png"), PNG);
    // Hold the DELETE before it unlinks mark.png until the PUT has renamed a
    // new mark.png into place (or 300 ms pass).
    let deleting!: () => void;
    const deleteStarted = new Promise<void>((r) => (deleting = r));
    let pngRenamed!: () => void;
    const pngDone = new Promise<void>((r) => (pngRenamed = r));
    let held = false;
    fsGate.beforeUnlink = async (target) => {
      if (held || !target.endsWith("mark.png")) return;
      held = true;
      deleting();
      await Promise.race([pngDone, new Promise((r) => setTimeout(r, 300))]);
    };
    fsGate.afterRename = async (target) => {
      if (target.endsWith("mark.png")) pngRenamed();
    };
    const del = request(app()).delete("/api/projects/p/mark").then((r) => r);
    await deleteStarted;
    const put = await request(app()).put("/api/projects/p/mark").attach("image", PNG, "a.png");
    expect((await del).status).toBe(204);
    expect(put.status).toBe(200);
    expect(markFiles()).toEqual(["mark.png"]);
  });

  it("GET serves an archived project's mark; writes stay live-only", async () => {
    const archived = join(projects.dir(), "archived", "old");
    mkdirSync(archived, { recursive: true });
    writeFileSync(join(archived, "PROJECT.md"), "# old");
    writeFileSync(join(archived, "mark.png"), PNG);
    const res = await request(app()).get("/api/projects/old/mark");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/png/);
    expect((await request(app()).put("/api/projects/old/mark").attach("image", SVG, "b.svg")).status).toBe(404);
    expect((await request(app()).delete("/api/projects/old/mark")).status).toBe(404);
    expect(readdirSync(archived).filter((f) => f.startsWith("mark."))).toEqual(["mark.png"]);
  });
});
