import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir();
vi.mock("../../config", () => configMock(() => projects.dir()));

// An in-memory stand-in for the manager: one live session, updated the way
// `updateSession` updates the real map.
const store = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; name: string; project: string; cwd: string; owner: string }>,
}));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  listSessions: vi.fn(() => store.sessions.map((s) => ({ ...s }))),
  updateSession: vi.fn((id: string, u: { name?: string; project?: string }) => {
    const s = store.sessions.find((x) => x.id === id);
    if (!s) return false;
    if (u.name !== undefined) s.name = u.name;
    if (u.project !== undefined) s.project = u.project;
    return true;
  }),
}));

import terminalRouter from "../terminal";
import { listSessions } from "../../lib/terminal-manager";

const app = () => makeApp(terminalRouter, "/api/terminal");
const mkProject = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "PROJECT.md"), `# ${name}\n`);
};

beforeEach(() => {
  store.sessions = [{ id: "s1", name: "motyl-1", project: "motyl", cwd: "/w", owner: "root" }];
  mkProject(projects.dir(), "motyl");
  mkProject(projects.dir(), "woozle");
  mkProject(join(projects.dir(), "archived"), "oldie");
});

describe("PATCH /api/terminal/sessions/:id — session move", () => {
  it("moving a session changes only its project", async () => {
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ project: "woozle" });
    expect(res.status).toBe(200);
    expect(listSessions()).toEqual([
      { id: "s1", name: "motyl-1", project: "woozle", cwd: "/w", owner: "root" },
    ]);
  });

  it("a move is visible in the next session list", async () => {
    await request(app()).patch("/api/terminal/sessions/s1").send({ project: "woozle" });
    const res = await request(app()).get("/api/terminal/sessions");
    expect(res.body[0].project).toBe("woozle");
  });

  it("moving to a missing project is rejected", async () => {
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ project: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(store.sessions[0].project).toBe("motyl");
  });

  it("moving to an archived project is rejected", async () => {
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ project: "oldie" });
    expect(res.status).toBe(400);
    expect(store.sessions[0].project).toBe("motyl");
  });

  it.each(["../motyl", "archived/oldie"])("project path %s is rejected", async (project) => {
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ project });
    expect(res.status).toBe(400);
    expect(store.sessions[0].project).toBe("motyl");
  });

  it("moving to a symlinked project dir is rejected", async () => {
    // Discovery skips symlinked dirs, so the panel never lists this alias.
    symlinkSync(join(projects.dir(), "archived", "oldie"), join(projects.dir(), "alias"));
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ project: "alias" });
    expect(res.status).toBe(400);
    expect(store.sessions[0].project).toBe("motyl");
  });

  it("unknown session id is 404", async () => {
    const res = await request(app()).patch("/api/terminal/sessions/zz").send({ project: "woozle" });
    expect(res.status).toBe(404);
  });

  it("rename-only patch still works", async () => {
    const res = await request(app()).patch("/api/terminal/sessions/s1").send({ name: "x" });
    expect(res.status).toBe(200);
    expect(store.sessions[0]).toMatchObject({ name: "x", project: "motyl" });
  });
});
