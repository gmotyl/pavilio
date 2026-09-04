import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/tmp/unused" }),
}));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(() => []),
  destroySession: vi.fn(),
  updateSession: vi.fn(() => true),
}));
vi.mock("../../lib/os-users", () => ({
  listOsUsers: vi.fn(() => [
    { username: "greg", homeDir: "/home/greg", shell: "/bin/zsh" },
    { username: "greg-ip", homeDir: "/home/greg-ip", shell: "/bin/bash" },
  ]),
}));

import terminalRouter from "../terminal";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/terminal", terminalRouter);
  return app;
}

describe("GET /api/terminal/os-users", () => {
  it("returns usernames only, not homeDir or shell", async () => {
    const res = await request(makeApp()).get("/api/terminal/os-users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ username: "greg" }, { username: "greg-ip" }]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("homeDir");
    expect(body).not.toContain("shell");
  });
});
