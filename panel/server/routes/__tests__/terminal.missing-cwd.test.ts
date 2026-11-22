import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { configMock, makeApp } from "../../test-kit";

let projectsDir = "";

vi.mock("../../config", () => configMock(() => projectsDir));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(() => ({ id: "s1" })),
  listSessions: vi.fn(() => []),
  closeSession: vi.fn(),
  updateSession: vi.fn(() => true),
}));
vi.mock("../../lib/project-default-user", () => ({
  getDefaultUser: vi.fn(),
}));

import terminalRouter from "../terminal";
import { createSession, listSessions } from "../../lib/terminal-manager";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "terminal-missing-cwd-"));
  projectsDir = join(root, "projects");
  mkdirSync(projectsDir);
  vi.mocked(createSession).mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("terminal routes and directories missing on this machine", () => {
  it("refuses a session in a missing cwd with 400 cwd-missing", async () => {
    const app = makeApp(terminalRouter, "/api/terminal");
    const missing = join(root, "nope");

    const res = await request(app)
      .post("/api/terminal/sessions")
      .send({ cwd: missing, project: "alpha" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "cwd-missing",
      path: missing,
      error: `Directory not on this machine: ${missing}`,
    });
    expect(createSession).not.toHaveBeenCalled();
    const sessions = await request(app).get("/api/terminal/sessions");
    expect(sessions.body).toEqual([]);
    expect(listSessions).toHaveBeenCalled();
  });

  it("creates a session for an existing or omitted cwd as before", async () => {
    const app = makeApp(terminalRouter, "/api/terminal");
    const existing = join(root, "repo");
    mkdirSync(existing);

    const withCwd = await request(app)
      .post("/api/terminal/sessions")
      .send({ cwd: existing, project: "alpha", runAsUser: "greg-ip" });
    expect(withCwd.status).toBe(201);
    // The requested path is handed over untranslated; run-as translation and
    // the home fallback stay inside createSession.
    expect(createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: existing, runAsUser: "greg-ip" }),
    );

    const omitted = await request(app)
      .post("/api/terminal/sessions")
      .send({ project: "alpha" });
    expect(omitted.status).toBe(201);
    expect(createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: root }),
    );
  });

  it("start-dirs omits a linked repo that is not on this machine", async () => {
    const present = join(root, "present-repo");
    mkdirSync(present);
    mkdirSync(join(projectsDir, "alpha"));
    writeFileSync(
      join(projectsDir, "alpha", "repos.json"),
      JSON.stringify([
        { name: "present", path: present },
        { name: "missing", path: join(root, "missing-repo") },
      ]),
    );

    const res = await request(makeApp(terminalRouter, "/api/terminal"))
      .get("/api/terminal/start-dirs")
      .query({ project: "alpha" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { label: "Projects", path: projectsDir },
      { label: "Home", path: process.env.HOME || "/tmp" },
      { label: "present", path: present },
    ]);
  });
});
