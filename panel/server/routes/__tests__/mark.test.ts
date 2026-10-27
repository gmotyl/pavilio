import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-mark-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));

import markRouter from "../mark";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 250, 251]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

const app = () => makeApp(markRouter, "/api/projects");
const projectDir = (project = "p") => join(projects.dir(), project);
const markFiles = (project = "p") =>
  readdirSync(projectDir(project)).filter((f) => f.startsWith("mark.")).sort();

describe("/api/projects/:name/mark", () => {
  beforeEach(() => {
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
});
