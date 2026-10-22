import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { configMock, makeApp } from "../../test-kit";

vi.mock("../../config", () => configMock(() => "/tmp/unused"));
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

describe("GET /api/terminal/os-users", () => {
  it("returns usernames only, not homeDir or shell", async () => {
    const res = await request(makeApp(terminalRouter, "/api/terminal")).get("/api/terminal/os-users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ username: "greg" }, { username: "greg-ip" }]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("homeDir");
    expect(body).not.toContain("shell");
  });
});
