import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, existsSync, utimesSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("arch-");

vi.mock("../../config", () => configMock(() => projects.dir()));

import archiveRouter from "../archive";

function seedProject(rel: string) {
  mkdirSync(join(projects.dir(), rel), { recursive: true });
  writeFileSync(join(projects.dir(), rel, "PROJECT.md"), `# ${rel}`);
}

describe("archive routes", () => {
  it("archives a project by moving it to archived/", async () => {
    seedProject("alpha");
    const res = await request(makeApp(archiveRouter, "/api/archive")).post("/api/archive/alpha");
    expect(res.status).toBe(200);
    expect(existsSync(join(projects.dir(), "archived", "alpha", "PROJECT.md"))).toBe(true);
    expect(existsSync(join(projects.dir(), "alpha"))).toBe(false);
  });

  it("404s on unknown project", async () => {
    const res = await request(makeApp(archiveRouter, "/api/archive")).post("/api/archive/nope");
    expect(res.status).toBe(404);
  });

  it("409s when archived target already exists", async () => {
    seedProject("alpha");
    seedProject("archived/alpha");
    const res = await request(makeApp(archiveRouter, "/api/archive")).post("/api/archive/alpha");
    expect(res.status).toBe(409);
    expect(existsSync(join(projects.dir(), "alpha"))).toBe(true);
  });

  it("rejects path traversal names", async () => {
    for (const bad of ["..", "a%2Fb", "a%5Cb", "%2E%2E%2Fetc"]) {
      const res = await request(makeApp(archiveRouter, "/api/archive")).post(`/api/archive/${bad}`);
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
    expect(existsSync(join(projects.dir(), "archived"))).toBe(false);
  });

  it("restores an archived project", async () => {
    seedProject("archived/beta");
    const res = await request(makeApp(archiveRouter, "/api/archive")).post("/api/archive/beta/restore");
    expect(res.status).toBe(200);
    expect(existsSync(join(projects.dir(), "beta", "PROJECT.md"))).toBe(true);
    expect(existsSync(join(projects.dir(), "archived", "beta"))).toBe(false);
  });

  it("409s restoring onto an existing active project", async () => {
    seedProject("beta");
    seedProject("archived/beta");
    const res = await request(makeApp(archiveRouter, "/api/archive")).post("/api/archive/beta/restore");
    expect(res.status).toBe(409);
  });

  it("lists archived projects with archivedAt", async () => {
    seedProject("archived/beta");
    seedProject("archived/gamma");
    const res = await request(makeApp(archiveRouter, "/api/archive")).get("/api/archive");
    expect(res.status).toBe(200);
    const names = res.body.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(["beta", "gamma"]);
    expect(typeof res.body[0].archivedAt).toBe("string");
  });

  it("archivedAt reflects archive time, not last content modification", async () => {
    seedProject("alpha");
    const before = Date.now() - 1000;
    const app = makeApp(archiveRouter, "/api/archive");
    await request(app).post("/api/archive/alpha");
    const res = await request(app).get("/api/archive");
    expect(new Date(res.body[0].archivedAt).getTime()).toBeGreaterThan(before);
  });

  it("archive list rows include kind and description", async () => {
    mkdirSync(join(projects.dir(), "archived", "voices"), { recursive: true });
    writeFileSync(
      join(projects.dir(), "archived", "voices", "PROJECT.md"),
      "---\nkind: research\ntopic: edge tts voices\n---\n# Voices\n",
    );
    seedProject("archived/plain");
    // An active project with the same name must not leak into the archived row.
    mkdirSync(join(projects.dir(), "plain"), { recursive: true });
    writeFileSync(
      join(projects.dir(), "plain", "PROJECT.md"),
      "---\nkind: research\ntopic: live copy\n---\n# Plain\n",
    );
    const older = new Date(Date.now() - 60_000);
    utimesSync(join(projects.dir(), "archived", "plain"), older, older);

    const res = await request(makeApp(archiveRouter, "/api/archive")).get("/api/archive");
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(["voices", "plain"]);
    expect(res.body[0]).toMatchObject({ kind: "research", description: "edge tts voices" });
    expect(res.body[1]).toMatchObject({ kind: "project", description: null });
    expect(typeof res.body[1].archivedAt).toBe("string");
  });

  it("returns [] when archived/ does not exist", async () => {
    const res = await request(makeApp(archiveRouter, "/api/archive")).get("/api/archive");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
