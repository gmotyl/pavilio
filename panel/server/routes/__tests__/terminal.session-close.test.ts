import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { configMock, makeApp } from "../../test-kit";

vi.mock("../../config", () => configMock(() => "/tmp/unused"));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(() => []),
  closeSession: vi.fn(),
  updateSession: vi.fn(() => true),
}));

import terminalRouter from "../terminal";
import { closeSession, createSession } from "../../lib/terminal-manager";

const del = () => request(makeApp(terminalRouter, "/api/terminal")).delete("/api/terminal/sessions/s1");

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(closeSession).mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("DELETE /api/terminal/sessions/:id", () => {
  it("DELETE answers 200 once the session exited", async () => {
    vi.mocked(closeSession).mockResolvedValue("exited");
    const res = await del();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(closeSession).toHaveBeenCalledWith("s1");
  });

  it("DELETE answers 404 for an unknown session", async () => {
    vi.mocked(closeSession).mockResolvedValue("not-found");
    const res = await del();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Session not found" });
  });

  it("DELETE answers 500 when the session did not exit", async () => {
    vi.mocked(closeSession).mockResolvedValue("still-alive");
    const res = await del();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Session did not exit" });
  });

  it("DELETE answers 500 when the close throws", async () => {
    vi.mocked(closeSession).mockRejectedValue(new Error("boom"));
    const res = await del();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Session close failed" });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("POST /api/terminal/sessions during shutdown", () => {
  it("POST answers 503 when the panel is shutting down", async () => {
    vi.mocked(createSession).mockImplementation(() => {
      throw Object.assign(new Error("shutting down"), { code: "PANEL_SHUTTING_DOWN" });
    });
    const res = await request(makeApp(terminalRouter, "/api/terminal"))
      .post("/api/terminal/sessions")
      .send({ cwd: "/tmp", project: "p" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Panel is shutting down" });
  });
});
