import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));
const { rebuildIndex } = vi.hoisted(() => ({ rebuildIndex: vi.fn() }));
vi.mock("../../lib/file-index", () => ({
  getFileIndex: () => [],
  rebuildIndex,
}));

import mockupsRouter from "../mockups";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 250, 251]);
const HTML = Buffer.from("<!doctype html><html><body>hi</body></html>");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", mockupsRouter);
  return app;
}

function mockupsDir(project = "p") {
  return join(projectsDir, project, "mockups");
}

function listMockups(project = "p"): string[] {
  const dir = mockupsDir(project);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe("POST /api/projects/:project/mockups/import", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
    rebuildIndex.mockClear();
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-mockup-import-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "p"), { recursive: true });
    writeFileSync(join(projectsDir, "p", "PROJECT.md"), "# p");
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("imports a png byte-for-byte under a dated slug", async () => {
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", PNG, "Frame 12.png")
      .field("slugs", "frame-12");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      files: [
        { name: "2026-10-07-frame-12.png", relativePath: "p/mockups/2026-10-07-frame-12.png", ok: true },
      ],
    });
    expect(readFileSync(join(mockupsDir(), "2026-10-07-frame-12.png")).equals(PNG)).toBe(true);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
  });

  it("normalises the slug", async () => {
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", PNG, "x.png")
      .field("slugs", "../Account Details / Mobile!!");
    expect(res.body.files[0]).toMatchObject({ ok: true, name: "2026-10-07-account-details-mobile.png" });
    expect(listMockups()).toEqual(["2026-10-07-account-details-mobile.png"]);
  });

  it("suffixes on collision without overwriting", async () => {
    mkdirSync(mockupsDir(), { recursive: true });
    writeFileSync(join(mockupsDir(), "2026-10-07-frame-12.png"), "original");
    writeFileSync(join(mockupsDir(), "2026-10-07-frame-12-2.png"), "second");
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", PNG, "a.png")
      .attach("files", PNG, "b.png")
      .field("slugs", "frame-12")
      .field("slugs", "frame-12");
    expect(res.body.files.map((f: { name: string }) => f.name)).toEqual([
      "2026-10-07-frame-12-3.png",
      "2026-10-07-frame-12-4.png",
    ]);
    expect(readFileSync(join(mockupsDir(), "2026-10-07-frame-12.png"), "utf-8")).toBe("original");
    expect(readFileSync(join(mockupsDir(), "2026-10-07-frame-12-2.png"), "utf-8")).toBe("second");
  });

  it("rejects a disguised file but imports the rest", async () => {
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", HTML, "fake.png")
      .attach("files", Buffer.from("%PDF-1.7"), "doc.pdf")
      .attach("files", PNG, "real.png")
      .field("slugs", "fake")
      .field("slugs", "doc")
      .field("slugs", "real");
    expect(res.status).toBe(200);
    const [fake, pdf, real] = res.body.files;
    expect(fake).toMatchObject({ ok: false, name: "fake.png" });
    expect(fake.error).toMatch(/png/i);
    expect(pdf).toMatchObject({ ok: false, name: "doc.pdf" });
    expect(pdf.error).toMatch(/unsupported/i);
    expect(real).toMatchObject({ ok: true, name: "2026-10-07-real.png" });
    expect(listMockups()).toEqual(["2026-10-07-real.png"]);
  });

  it("rejects files over 20 MB", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    PNG.copy(big);
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", big, "big.png")
      .attach("files", PNG, "small.png")
      .field("slugs", "big")
      .field("slugs", "small");
    expect(res.status).toBe(200);
    expect(res.body.files[0]).toMatchObject({ ok: false, name: "big.png" });
    expect(res.body.files[0].error).toMatch(/20 MB/);
    expect(res.body.files[1]).toMatchObject({ ok: true, name: "2026-10-07-small.png" });
    expect(listMockups()).toEqual(["2026-10-07-small.png"]);
  });

  it("refuses traversal and unknown projects", async () => {
    const traversal = await request(makeApp())
      .post("/api/projects/..%2Fp/mockups/import")
      .attach("files", PNG, "a.png")
      .field("slugs", "a");
    expect(traversal.status).toBe(400);

    const slash = await request(makeApp())
      .post("/api/projects/p%2F..%2Fq/mockups/import")
      .attach("files", PNG, "a.png")
      .field("slugs", "a");
    expect(slash.status).toBe(400);

    // A directory without PROJECT.md is not a project
    mkdirSync(join(projectsDir, "ghost"), { recursive: true });
    const unknown = await request(makeApp())
      .post("/api/projects/ghost/mockups/import")
      .attach("files", PNG, "a.png")
      .field("slugs", "a");
    expect(unknown.status).toBe(404);

    expect(existsSync(join(tmpRoot, "mockups"))).toBe(false);
    expect(existsSync(join(projectsDir, "mockups"))).toBe(false);
    expect(listMockups("ghost")).toEqual([]);
    expect(listMockups()).toEqual([]);
    expect(rebuildIndex).not.toHaveBeenCalled();
  });

  it("rebuilds the index once per batch", async () => {
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", PNG, "a.png")
      .attach("files", HTML, "b.html")
      .attach("files", PNG, "c.png")
      .field("slugs", "a")
      .field("slugs", "b")
      .field("slugs", "c");
    expect(res.body.files.every((f: { ok: boolean }) => f.ok)).toBe(true);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/projects/:project/mockups/inspect", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-mockup-inspect-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "p"), { recursive: true });
    writeFileSync(join(projectsDir, "p", "PROJECT.md"), "# p");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("counts external resources in html and svg", async () => {
    const html = Buffer.from(
      `<!doctype html><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
       <img src="https://a.example.com/1.png"><img src="https://a.example.com/2.png"><img src="x.png">`,
    );
    const svg = Buffer.from('<svg><image href="//cdn.example.com/a.png"/></svg>');
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/inspect")
      .attach("files", html, "page.html")
      .attach("files", svg, "icon.svg")
      .attach("files", PNG, "shot.png");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      files: [
        { name: "page.html", externalCount: 3 },
        { name: "icon.svg", externalCount: 1 },
        { name: "shot.png", externalCount: 0 },
      ],
    });
    expect(listMockups()).toEqual([]);
  });
});
