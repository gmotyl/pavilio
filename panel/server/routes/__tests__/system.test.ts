import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/h/git/prv/notes" }),
}));

import systemRouter from "../system";

function makeApp() {
  const app = express();
  app.use("/api/system", systemRouter);
  return app;
}

describe("system route", () => {
  const original = process.env.WSL_DISTRO_NAME;
  afterEach(() => {
    if (original === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = original;
  });

  it("reports the WSL distro name when set", async () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    const res = await request(makeApp()).get("/api/system");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ wslDistro: "Ubuntu" });
  });

  it("reports null when not running under WSL", async () => {
    delete process.env.WSL_DISTRO_NAME;
    const res = await request(makeApp()).get("/api/system");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ wslDistro: null });
  });

  it("reports the workspace root as the projects directory's parent", async () => {
    // The projects dir here is named "notes": the root is its parent whatever
    // that directory is called.
    const res = await request(makeApp()).get("/api/system");
    expect(res.status).toBe(200);
    expect(res.body.workspaceRoot).toBe("/h/git/prv");
  });
});
