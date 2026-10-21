import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, fileIndexMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-raw-cross-root-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/file-index", () => fileIndexMock());
vi.mock("../../lib/file-roots", () => ({
  isValidRoot: (root: string) =>
    ["skills", "claude-commands", "opencode-commands", "projects"].includes(root),
  resolveRoot: (root: string) => {
    if (root === "skills") return join(projects.root(), "skills");
    if (root === "claude-commands") return join(projects.root(), ".claude", "commands");
    if (root === "opencode-commands") return join(projects.root(), ".opencode", "commands");
    return join(projects.root(), "projects");
  },
}));

import filesRouter from "../files";

describe("GET /api/files/raw?root=<id>", () => {
  beforeEach(() => {
    mkdirSync(join(projects.dir(), "notes"), { recursive: true });
    writeFileSync(join(projects.dir(), "notes", "secret.md"), "secret content\n");
    const assets = join(projects.root(), "skills", "memo", "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(
      join(assets, "a.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    writeFileSync(join(assets, "a.html"), "<!doctype html><script>1</script>");
  });

  it("serves a file from the selected root", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/raw/memo/assets/pic.png?root=skills");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("applies the same CSP to cross-root svg and html", async () => {
    const svg = await request(makeApp(filesRouter, "/api/files")).get("/api/files/raw/memo/assets/a.svg?root=skills");
    expect(svg.status).toBe(200);
    expect(svg.headers["content-security-policy"]).toBe("sandbox");
    const html = await request(makeApp(filesRouter, "/api/files")).get("/api/files/raw/memo/assets/a.html?root=skills");
    expect(html.status).toBe(200);
    expect(html.headers["content-security-policy"]).toBe("sandbox allow-scripts");
  });

  it("blocks traversal out of the selected root", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get(
      "/api/files/raw/..%2F..%2Fprojects%2Fnotes%2Fsecret.md?root=skills",
    );
    expect(res.status).toBe(403);
  });

  it("does not fall back to projectsDir for a missing cross-root file", async () => {
    const res = await request(makeApp(filesRouter, "/api/files")).get("/api/files/raw/notes/secret.md?root=skills");
    expect(res.status).toBe(404);
  });
});
