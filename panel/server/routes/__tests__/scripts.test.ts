import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";
let workspaceRoot = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));
vi.mock("../../lib/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../lib/discovery")>("../../lib/discovery");
  return { ...actual, discoverProjects: () => [] };
});

import scriptsRouter, { loadScriptsConfig } from "../scripts";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", scriptsRouter);
  return app;
}

function seedScriptsJson(content: string | object) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  mkdirSync(join(workspaceRoot, "scripts"), { recursive: true });
  writeFileSync(join(workspaceRoot, "scripts", "scripts.json"), text);
}

function seedScript(name: string, body: string) {
  const path = join(workspaceRoot, "scripts", name);
  mkdirSync(join(workspaceRoot, "scripts"), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-scripts-test-"));
  workspaceRoot = tmpRoot;
  projectsDir = join(tmpRoot, "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadScriptsConfig", () => {
  it("returns { scripts: [] } when scripts.json is missing", () => {
    const cfg = loadScriptsConfig(workspaceRoot);
    expect(cfg).toEqual({ scripts: [] });
  });

  it("returns { scripts: [] } and logs a warn when scripts.json has invalid JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedScriptsJson("{ not valid json");
    const cfg = loadScriptsConfig(workspaceRoot);
    expect(cfg).toEqual({ scripts: [] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("parses a valid scripts.json and exposes all fields", () => {
    seedScriptsJson({
      scripts: [
        {
          id: "x",
          label: "X",
          description: "desc",
          script: "scripts/x.sh",
          outputMatch: "RESULT: (.+)",
          icon: "Play",
          timeoutSec: 30,
        },
      ],
    });
    const cfg = loadScriptsConfig(workspaceRoot);
    expect(cfg.scripts).toHaveLength(1);
    expect(cfg.scripts[0]).toMatchObject({
      id: "x",
      label: "X",
      description: "desc",
      script: "scripts/x.sh",
      outputMatch: "RESULT: (.+)",
      icon: "Play",
      timeoutSec: 30,
    });
  });
});

describe("GET /api/scripts", () => {
  it("returns the parsed array", async () => {
    seedScriptsJson({
      scripts: [
        { id: "a", label: "A", description: "d", script: "scripts/a.sh" },
      ],
    });
    const res = await request(makeApp()).get("/api/scripts");
    expect(res.status).toBe(200);
    expect(res.body.scripts).toHaveLength(1);
    expect(res.body.scripts[0].id).toBe("a");
  });

  it("returns empty array when scripts.json is missing", async () => {
    const res = await request(makeApp()).get("/api/scripts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scripts: [] });
  });

  it("exposes optional fields including timeoutSec verbatim", async () => {
    seedScriptsJson({
      scripts: [
        {
          id: "a",
          label: "A",
          description: "d",
          script: "scripts/a.sh",
          timeoutSec: 30,
          icon: "Play",
          outputMatch: "R: (.+)",
        },
      ],
    });
    const res = await request(makeApp()).get("/api/scripts");
    expect(res.body.scripts[0].timeoutSec).toBe(30);
    expect(res.body.scripts[0].icon).toBe("Play");
    expect(res.body.scripts[0].outputMatch).toBe("R: (.+)");
  });
});

function seedProject(name: string) {
  mkdirSync(join(projectsDir, name), { recursive: true });
  writeFileSync(join(projectsDir, name, "PROJECT.md"), "# " + name);
}

describe("POST /api/projects/:name/scripts/:id/run — validation", () => {
  it("returns 404 when the project does not exist", async () => {
    seedScriptsJson({
      scripts: [{ id: "x", label: "X", description: "d", script: "scripts/x.sh" }],
    });
    seedScript("x.sh", "#!/bin/bash\necho ok\n");
    const res = await request(makeApp())
      .post("/api/projects/no-such/scripts/x/run");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/project/i);
  });

  it("returns 404 when the script id does not exist", async () => {
    seedProject("alpha");
    seedScriptsJson({
      scripts: [{ id: "x", label: "X", description: "d", script: "scripts/x.sh" }],
    });
    seedScript("x.sh", "#!/bin/bash\necho ok\n");
    const res = await request(makeApp())
      .post("/api/projects/alpha/scripts/no-such/run");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/script/i);
  });

  it("returns 400 when the configured script path is outside scripts/", async () => {
    seedProject("alpha");
    seedScriptsJson({
      scripts: [
        { id: "x", label: "X", description: "d", script: "../etc/passwd.sh" },
      ],
    });
    const res = await request(makeApp())
      .post("/api/projects/alpha/scripts/x/run");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scripts/i);
  });

  it("returns 400 when the configured path does not end in .sh", async () => {
    seedProject("alpha");
    seedScriptsJson({
      scripts: [
        { id: "x", label: "X", description: "d", script: "scripts/x.py" },
      ],
    });
    seedScript("x.py", "print('hi')");
    const res = await request(makeApp())
      .post("/api/projects/alpha/scripts/x/run");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.sh/);
  });

  it("returns 400 when the resolved file does not exist", async () => {
    seedProject("alpha");
    seedScriptsJson({
      scripts: [
        { id: "x", label: "X", description: "d", script: "scripts/missing.sh" },
      ],
    });
    const res = await request(makeApp())
      .post("/api/projects/alpha/scripts/x/run");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found|missing|exist/i);
  });
});
