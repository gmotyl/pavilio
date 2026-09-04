import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/tmp/unused" }),
}));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(() => ({ id: "s1" })),
  listSessions: vi.fn(() => []),
  destroySession: vi.fn(),
  updateSession: vi.fn(() => true),
}));
vi.mock("../../lib/project-default-user", () => ({
  getDefaultUser: vi.fn(),
}));

import terminalRouter from "../terminal";
import { createSession } from "../../lib/terminal-manager";
import { getDefaultUser } from "../../lib/project-default-user";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/terminal", terminalRouter);
  return app;
}

beforeEach(() => {
  vi.mocked(createSession).mockClear();
  vi.mocked(getDefaultUser).mockReset();
});

describe("POST /api/terminal/sessions runAsUser resolution", () => {
  it("resolves runAsUser from the project's stored default when omitted", async () => {
    vi.mocked(getDefaultUser).mockReturnValue("greg-ip");

    const res = await request(makeApp())
      .post("/api/terminal/sessions")
      .send({ project: "alpha" });

    expect(res.status).toBe(201);
    expect(getDefaultUser).toHaveBeenCalledWith("alpha");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ runAsUser: "greg-ip" }),
    );
  });

  it("keeps an explicit runAsUser over the stored default", async () => {
    vi.mocked(getDefaultUser).mockReturnValue("greg-ip");

    const res = await request(makeApp())
      .post("/api/terminal/sessions")
      .send({ project: "alpha", runAsUser: "greg" });

    expect(res.status).toBe(201);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ runAsUser: "greg" }),
    );
  });
});
