import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-raw-csp-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());

import filesRouter from "../files";

describe("GET /api/files/raw CSP", () => {
  beforeEach(() => {
    const mockups = join(projects.dir(), "p", "mockups");
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
    const res = await request(makeApp(filesRouter, "/api/files")).get(`/api/files/raw/p/mockups/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(csp);
  });
});
