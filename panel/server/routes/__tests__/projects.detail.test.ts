import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("proj-detail-");

vi.mock("../../config", () => configMock(() => projects.dir()));

import projectsRouter from "../projects";
import archiveRouter from "../archive";

function seedProject(rel: string, body = `# ${rel}`) {
  mkdirSync(join(projects.dir(), rel), { recursive: true });
  writeFileSync(join(projects.dir(), rel, "PROJECT.md"), body);
}

describe("GET /api/projects/:name", () => {
  it("detail returns a live project with archived false", async () => {
    seedProject("alpha", "---\nkind: research\n---\n# alpha");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alpha");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "alpha",
      path: join(projects.dir(), "alpha"),
      kind: "research",
      archived: false,
    });
    expect(res.body).not.toHaveProperty("archivedAt");
  });

  it("detail falls back to archived with archivedAt", async () => {
    seedProject("archived/beta");
    const when = new Date("2026-03-04T05:06:07.000Z");
    utimesSync(join(projects.dir(), "archived", "beta"), when, when);

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/beta");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "beta",
      path: join(projects.dir(), "archived", "beta"),
      archived: true,
      archivedAt: when.toISOString(),
    });

    const list = await request(makeApp(archiveRouter, "/api/archive")).get("/api/archive");
    const row = list.body.find((r: { name: string }) => r.name === "beta");
    expect(res.body.archivedAt).toBe(row.archivedAt);
  });

  it("detail 404s for unknown and traversal names", async () => {
    seedProject("alpha");
    mkdirSync(join(projects.dir(), "archived"), { recursive: true });
    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get("/api/projects/missing")).status).toBe(404);
    expect((await request(app).get("/api/projects/archived")).status).toBe(404);
    expect((await request(app).get("/api/projects/..")).status).toBe(404);
    expect((await request(app).get("/api/projects/..%2F..%2Fetc")).status).toBe(404);
    expect((await request(app).get("/api/projects/archived%2Falpha")).status).toBe(404);
  });
});
