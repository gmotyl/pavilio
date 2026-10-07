import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));
vi.mock("../../lib/file-index", () => ({ getFileIndex: () => [], rebuildIndex: vi.fn() }));
// Shrink the per-request cap so the test does not have to upload 100 MB
vi.mock("../../lib/mockup-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/mockup-import")>()),
  MOCKUP_MAX_TOTAL_BYTES: 40,
}));

import mockupsRouter from "../mockups";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7]);

function makeApp() {
  const app = express();
  app.use("/api/projects", mockupsRouter);
  return app;
}

describe("POST /api/projects/:project/mockups/import — total size cap", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-mockup-total-test-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(join(projectsDir, "p"), { recursive: true });
    writeFileSync(join(projectsDir, "p", "PROJECT.md"), "# p");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("fails the entries past the total cap and keeps the earlier ones", async () => {
    // 16 + 16 = 32 bytes fit under 40; the third file crosses it, and the
    // 4-byte fourth one fails too even though it would still fit
    const res = await request(makeApp())
      .post("/api/projects/p/mockups/import")
      .attach("files", PNG, "a.png")
      .attach("files", PNG, "b.png")
      .attach("files", PNG, "c.png")
      .attach("files", PNG.subarray(0, 4), "d.png")
      .field("slugs", "a")
      .field("slugs", "b")
      .field("slugs", "c")
      .field("slugs", "d");
    expect(res.status).toBe(200);
    const [a, b, c, d] = res.body.files;
    expect(a).toMatchObject({ ok: true, name: expect.stringMatching(/-a\.png$/) });
    expect(b).toMatchObject({ ok: true, name: expect.stringMatching(/-b\.png$/) });
    expect(c).toMatchObject({ ok: false, name: "c.png" });
    expect(c.error).toMatch(/total/i);
    expect(d).toMatchObject({ ok: false, name: "d.png" });
    expect(d.error).toMatch(/total/i);
    expect(readdirSync(join(projectsDir, "p", "mockups"))).toHaveLength(2);
  });
});
