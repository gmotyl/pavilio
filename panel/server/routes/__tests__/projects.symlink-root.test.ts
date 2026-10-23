import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-symlink-root-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../lib/discovery")>("../../lib/discovery");
  return { ...actual, discoverProjects: () => [] };
});

import projectsRouter from "../projects";

/** A project-shaped dir outside projectsDir, with files every read route would serve. */
function seedOutside(): string {
  const outside = join(projects.root(), "outside");
  mkdirSync(join(outside, "plans"), { recursive: true });
  mkdirSync(join(outside, "wiki"), { recursive: true });
  writeFileSync(join(outside, "PROJECT.md"), "# outside");
  writeFileSync(join(outside, "CONTEXT.md"), "# secret context");
  writeFileSync(join(outside, "plans", "x.md"), "# secret plan");
  writeFileSync(join(outside, "wiki", "index.md"), "# secret wiki");
  return outside;
}

const cases: { label: string; name: string; link: () => string }[] = [
  { label: "archived/<name>", name: "evil", link: () => join(projects.dir(), "archived", "evil") },
  { label: "live <name>", name: "evil2", link: () => join(projects.dir(), "evil2") },
];

describe.each(cases)("a $label symlink to a dir outside projectsDir", ({ name, link }) => {
  function plant(): string {
    const outside = seedOutside();
    mkdirSync(join(projects.dir(), "archived"), { recursive: true });
    symlinkSync(outside, link(), "dir");
    // Allowed-shaped paths as the client would send them: lexically under the project dir.
    return link();
  }

  it("is not a project for GET /:name", async () => {
    plant();
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(`/api/projects/${name}`);
    expect(res.status).toBe(404);
  });

  it("is not served by /context or /context/read", async () => {
    const dir = plant();
    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get(`/api/projects/${name}/context`)).status).toBe(404);
    const read = await request(app)
      .get(`/api/projects/${name}/context/read`)
      .query({ path: join(dir, "CONTEXT.md") });
    expect(read.status).toBe(404);
    expect(read.body.content).toBeUndefined();
  });

  it("is not served by /plans-tree or /plans/read", async () => {
    const dir = plant();
    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get(`/api/projects/${name}/plans-tree`)).status).toBe(404);
    const read = await request(app)
      .get(`/api/projects/${name}/plans/read`)
      .query({ path: join(dir, "plans", "x.md") });
    expect(read.status).toBe(404);
    expect(read.body.content).toBeUndefined();
  });

  it("is not served by /wiki", async () => {
    plant();
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(`/api/projects/${name}/wiki`);
    expect(res.status).toBe(404);
  });
});

describe("a symlink that stays inside projectsDir", () => {
  it("still resolves as the project it points at", async () => {
    const real = join(projects.dir(), "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "PROJECT.md"), "# real");
    writeFileSync(join(real, "CONTEXT.md"), "# real context");
    symlinkSync(real, join(projects.dir(), "alias"), "dir");

    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get("/api/projects/alias")).status).toBe(200);
    expect((await request(app).get("/api/projects/alias/context")).status).toBe(200);
  });
});
