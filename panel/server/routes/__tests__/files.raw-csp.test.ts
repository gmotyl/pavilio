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
    writeFileSync(join(mockups, "B.SVG"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(mockups, "a.htm"), "<!doctype html><script>1</script>");
    writeFileSync(
      join(mockups, "a.xhtml"),
      '<html xmlns="http://www.w3.org/1999/xhtml"><script>1</script></html>',
    );
    writeFileSync(join(mockups, "a.xml"), '<?xml version="1.0"?><root/>');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // `sandbox` stops a served svg/xml from running script on the panel origin;
  // html mockups may run their own scripts, but still in an opaque origin.
  it.each<[string, string, string | undefined]>([
    ["raw svg", "a.svg", "sandbox"],
    ["raw html", "a.html", "sandbox allow-scripts"],
    ["upper-case svg", "B.SVG", "sandbox"],
    ["htm (like html)", "a.htm", "sandbox allow-scripts"],
    ["xhtml (like html)", "a.xhtml", "sandbox allow-scripts"],
    ["xml (without scripts)", "a.xml", "sandbox"],
    ["raw png (no csp)", "a.png", undefined],
  ])("%s is served with csp %j", async (_label, name, csp) => {
    const res = await request(makeApp()).get(`/api/files/raw/p/mockups/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(csp);
  });
});
