import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-read-meta-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());
vi.mock("../../lib/file-roots", () => ({
  isValidRoot: (root: string) => root === "skills",
  resolveRoot: () => join(projects.root(), "skills"),
}));

import filesRouter from "../files";

describe("GET /api/files/read?meta=1", () => {
  beforeEach(() => {
    mkdirSync(join(projects.dir(), "pavilio", "mockups"), { recursive: true });
    writeFileSync(
      join(projects.dir(), "pavilio", "mockups", "hero.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]),
    );
    mkdirSync(join(projects.root(), "skills"), { recursive: true });
    writeFileSync(join(projects.root(), "skills", "x.png"), Buffer.from([0xff, 0xfe]));
  });

  it("returns the absolute path without the content", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/hero.png?meta=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.absolutePath).toBe(
      join(projects.dir(), "pavilio", "mockups", "hero.png"),
    );
    expect(res.body.content).toBe("");
  });

  it("returns no content for a cross-root meta read either", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/x.png?root=skills&meta=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.absolutePath).toBe(join(projects.root(), "skills", "x.png"));
    expect(res.body.content).toBe("");
  });

  it("still 404s a missing file", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/nope.png?meta=1",
    );
    expect(res.status).toBe(404);
  });

  it("still returns the content without meta", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/hero.png",
    );
    expect(res.status).toBe(200);
    expect(res.body.content.length).toBeGreaterThan(0);
  });
});

describe("GET /api/files/read?maxBytes=", () => {
  beforeEach(() => {
    mkdirSync(join(projects.dir(), "pavilio", "mockups"), { recursive: true });
    writeFileSync(join(projects.dir(), "pavilio", "mockups", "big.svg"), "<svg>" + "x".repeat(64) + "</svg>");
    mkdirSync(join(projects.root(), "skills"), { recursive: true });
    writeFileSync(join(projects.root(), "skills", "big.svg"), "<svg>" + "x".repeat(64) + "</svg>");
  });

  it("returns no content, flagged, for a file over the cap", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=16",
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      absolutePath: join(projects.dir(), "pavilio", "mockups", "big.svg"),
      content: "",
      tooLarge: true,
    });
  });

  it("applies the cap to a cross-root read too", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/read/big.svg?root=skills&maxBytes=16");
    expect(res.body).toMatchObject({ content: "", tooLarge: true });
  });

  it("returns the content of a file under the cap", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=4096",
    );
    expect(res.body.content).toMatch(/^<svg>/);
    expect(res.body.tooLarge).toBeUndefined();
  });

  it("ignores a malformed cap", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/read/pavilio/mockups/big.svg?maxBytes=lots",
    );
    expect(res.body.content).toMatch(/^<svg>/);
  });
});
