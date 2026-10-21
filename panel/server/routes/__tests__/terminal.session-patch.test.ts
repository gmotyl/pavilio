import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { configMock, makeApp } from "../../test-kit";

vi.mock("../../config", () => configMock(() => "/tmp/unused"));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(() => []),
  destroySession: vi.fn(),
  updateSession: vi.fn(() => true),
}));

import terminalRouter from "../terminal";
import { updateSession } from "../../lib/terminal-manager";

beforeEach(() => vi.mocked(updateSession).mockClear());

describe("PATCH /api/terminal/sessions/:id", () => {
  it("does not persist a colour sent in the body", async () => {
    const res = await request(makeApp(terminalRouter, "/api/terminal"))
      .patch("/api/terminal/sessions/s1")
      .send({ name: "renamed", color: "#f0c674" });

    expect(res.status).toBe(200);
    // Ignored, not rejected: PATCH is a partial update and every other unknown
    // field is already dropped, so failing only on `color` would be a special
    // case a stale tab would experience as a broken rename.
    expect(updateSession).toHaveBeenCalledWith("s1", { name: "renamed" });
  });

  it("still renames when only a name is sent", async () => {
    const res = await request(makeApp(terminalRouter, "/api/terminal"))
      .patch("/api/terminal/sessions/s1")
      .send({ name: "renamed" });

    expect(res.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith("s1", { name: "renamed" });
  });
});
