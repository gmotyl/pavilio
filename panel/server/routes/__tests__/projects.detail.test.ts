import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, utimesSync } from "fs";
import { request as httpRequest, createServer } from "http";
import type { AddressInfo } from "net";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("proj-detail-");

vi.mock("../../config", () => configMock(() => projects.dir()));

import projectsRouter from "../projects";
import archiveRouter from "../archive";
import { resolveProjectRoot } from "../../lib/discovery";

/** Status of a raw GET — unlike supertest, `http` sends the path verbatim (no `..` normalisation). */
async function rawStatus(app: Parameters<typeof createServer>[1], path: string): Promise<number> {
  const server = createServer(app).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

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

  it("detail guard rejects dot-segment names that reach the route verbatim", async () => {
    seedProject("alpha");
    mkdirSync(join(projects.dir(), "archived"), { recursive: true });
    // archived/.. is a directory, so only the name guard keeps these out.
    expect(resolveProjectRoot(projects.dir(), "..")).toBeNull();
    expect(resolveProjectRoot(projects.dir(), ".")).toBeNull();
    const app = makeApp(projectsRouter, "/api/projects");
    expect(await rawStatus(app, "/api/projects/%2e%2e")).toBe(404);
    expect(await rawStatus(app, "/api/projects/%2e%2e/wiki")).toBe(404);
  });

  it("detail 404s (not 500) for names with a NUL byte", async () => {
    seedProject("alpha");
    expect(resolveProjectRoot(projects.dir(), "a\0b")).toBeNull();
    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get("/api/projects/a%00b")).status).toBe(404);
    expect((await request(app).get("/api/projects/a%00b/wiki")).status).toBe(404);
  });
});
