import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-default-terminal-user-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/os-users", () => ({
  listOsUsers: vi.fn(() => [
    { username: "greg", homeDir: "/home/greg", shell: "/bin/zsh" },
    { username: "greg-ip", homeDir: "/home/greg-ip", shell: "/bin/bash" },
  ]),
}));

import projectsRouter from "../projects";
import { getDefaultUser } from "../../lib/project-default-user";

/** A directory only counts as a project once it carries PROJECT.md — same rule discovery uses. */
function seedProject(name: string) {
  mkdirSync(join(projects.dir(), name), { recursive: true });
  writeFileSync(join(projects.dir(), name, "PROJECT.md"), `# ${name}\n`);
}

describe("GET /api/projects/default-terminal-users", () => {
  it("returns the map narrowed to discovered projects", async () => {
    seedProject("alpha");
    seedProject("beta");
    const app = makeApp(projectsRouter, "/api/projects");

    await request(app)
      .put("/api/projects/alpha/default-terminal-user")
      .send({ username: "greg-ip" });

    const res = await request(app).get("/api/projects/default-terminal-users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: { alpha: "greg-ip" } });
  });
});

describe("PUT /api/projects/:name/default-terminal-user", () => {
  it("rejects an undiscovered username with 400", async () => {
    seedProject("alpha");
    const app = makeApp(projectsRouter, "/api/projects");

    const put = await request(app)
      .put("/api/projects/alpha/default-terminal-user")
      .send({ username: "nobody" });

    expect(put.status).toBe(400);
    expect(getDefaultUser("alpha")).toBeUndefined();
  });

  it("persists a valid username and returns ok", async () => {
    seedProject("alpha");
    const app = makeApp(projectsRouter, "/api/projects");

    const put = await request(app)
      .put("/api/projects/alpha/default-terminal-user")
      .send({ username: "greg-ip" });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true });
    expect(getDefaultUser("alpha")).toBe("greg-ip");
  });

  it("404s for an unknown project", async () => {
    seedProject("alpha");
    const app = makeApp(projectsRouter, "/api/projects");

    const missing = await request(app)
      .put("/api/projects/ghost/default-terminal-user")
      .send({ username: "greg-ip" });

    expect(missing.status).toBe(404);
  });
});
