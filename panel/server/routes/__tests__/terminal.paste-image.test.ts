import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { existsSync, readFileSync, rmSync } from "fs";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/tmp/unused" }),
}));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(() => []),
  destroySession: vi.fn(),
  updateSession: vi.fn(),
}));

import terminalRouter from "../terminal";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/terminal", terminalRouter);
  return app;
}

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const created: string[] = [];
afterEach(() => {
  for (const p of created.splice(0)) rmSync(p, { force: true });
});

describe("POST /api/terminal/paste-image", () => {
  it("saves the image to a temp file and returns its absolute path", async () => {
    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(typeof res.body.path).toBe("string");
    created.push(res.body.path);
    expect(res.body.path.startsWith("/")).toBe(true);
    expect(res.body.path.endsWith(".png")).toBe(true);
    expect(existsSync(res.body.path)).toBe(true);
    expect(readFileSync(res.body.path).equals(PNG)).toBe(true);
  });

  it("rejects a missing file", async () => {
    const res = await request(makeApp()).post("/api/terminal/paste-image");
    expect(res.status).toBe(400);
  });

  it("rejects non-image uploads", async () => {
    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .attach("image", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });
});
