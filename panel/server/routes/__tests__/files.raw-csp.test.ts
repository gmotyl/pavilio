import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));
vi.mock("../../lib/file-index", () => ({
  getFileIndex: () => [],
  rebuildIndex: vi.fn(),
}));

import filesRouter from "../files";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/files", filesRouter);
  return app;
}

describe("GET /api/files/raw CSP", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-raw-csp-test-"));
    projectsDir = join(tmpRoot, "projects");
    const mockups = join(projectsDir, "p", "mockups");
    mkdirSync(mockups, { recursive: true });
    writeFileSync(
      join(mockups, "a.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    writeFileSync(join(mockups, "a.html"), "<!doctype html><script>1</script>");
    writeFileSync(join(mockups, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("raw svg is served sandboxed", async () => {
    const res = await request(makeApp()).get("/api/files/raw/p/mockups/a.svg");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("sandbox");
  });

  it("raw html is sandboxed but may run scripts", async () => {
    const res = await request(makeApp()).get("/api/files/raw/p/mockups/a.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("sandbox allow-scripts");
  });

  it("raw png gets no csp", async () => {
    const res = await request(makeApp()).get("/api/files/raw/p/mockups/a.png");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});
