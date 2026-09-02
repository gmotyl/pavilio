import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import projectsRouter from "../projects";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  return app;
}

/** A directory only counts as a project once it carries PROJECT.md — same rule discovery uses. */
function seedProject(name: string) {
  mkdirSync(join(projectsDir, name), { recursive: true });
  writeFileSync(join(projectsDir, name, "PROJECT.md"), `# ${name}\n`);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-colors-test-"));
  projectsDir = join(tmpRoot, "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/projects/colors", () => {
  it("returns a colour for every discovered project", async () => {
    seedProject("alpha");
    seedProject("beta");

    const res = await request(makeApp()).get("/api/projects/colors");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.colors).sort()).toEqual(["alpha", "beta"]);
    expect(res.body.colors.alpha).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(res.body.colors.beta).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("responds 500 when the store throws", async () => {
    seedProject("alpha");
    // `.panel` occupied by a file: the store cannot create its directory and throws.
    writeFileSync(join(projectsDir, ".panel"), "not a directory");

    const res = await request(makeApp()).get("/api/projects/colors");

    expect(res.status).toBe(500);
  });
});

describe("PUT /api/projects/:name/color", () => {
  it("stores a valid colour and reads it back", async () => {
    seedProject("alpha");
    const app = makeApp();

    const put = await request(app).put("/api/projects/alpha/color").send({ hex: "#123abc" });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true });

    const get = await request(app).get("/api/projects/colors");
    expect(get.body.colors.alpha).toBe("#123abc");
  });

  it("rejects an invalid hex with 400", async () => {
    seedProject("alpha");
    const app = makeApp();

    const before = await request(app).get("/api/projects/colors");
    const original = before.body.colors.alpha;

    const put = await request(app).put("/api/projects/alpha/color").send({ hex: "red" });
    expect(put.status).toBe(400);

    const after = await request(app).get("/api/projects/colors");
    expect(after.body.colors.alpha).toBe(original);
  });

  it("rejects an unknown project with 404", async () => {
    seedProject("alpha");
    const app = makeApp();

    const missing = await request(app).put("/api/projects/ghost/color").send({ hex: "#123abc" });
    expect(missing.status).toBe(404);

    // A traversal-shaped name is not a discovered project either — it never reaches the store.
    const traversal = await request(app).put("/api/projects/..%2F../color").send({ hex: "#123abc" });
    expect(traversal.status).toBe(404);

    const get = await request(app).get("/api/projects/colors");
    expect(Object.keys(get.body.colors)).toEqual(["alpha"]);
  });
});
