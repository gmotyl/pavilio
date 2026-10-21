import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-mockup-total-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());
// Shrink the per-request cap so the test does not have to upload 100 MB
vi.mock("../../lib/mockup-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/mockup-import")>()),
  MOCKUP_MAX_TOTAL_BYTES: 40,
}));

import mockupsRouter from "../mockups";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7]);

describe("POST /api/projects/:project/mockups/import — total size cap", () => {
  beforeEach(() => {
    mkdirSync(join(projects.dir(), "p"), { recursive: true });
    writeFileSync(join(projects.dir(), "p", "PROJECT.md"), "# p");
  });

  it("fails the entries past the total cap and keeps the earlier ones", async () => {
    // 16 + 16 = 32 bytes fit under 40; the third file crosses it, and the
    // 4-byte fourth one fails too even though it would still fit
    const res = await request(makeApp(mockupsRouter, "/api/projects"))
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
    expect(readdirSync(join(projects.dir(), "p", "mockups"))).toHaveLength(2);
  });
});
