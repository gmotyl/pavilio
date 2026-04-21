import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/mobile-auth", () => ({
  verifyLoginToken: vi.fn(),
  issueSessionCookie: vi.fn(),
  verifySessionCookie: vi.fn(),
}));

import * as auth from "../../lib/mobile-auth";
import { mobileAuthMiddleware } from "../mobile-auth";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(mobileAuthMiddleware);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.send("<html></html>"));
  app.post("/api/auth/mobile-login", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("mobileAuthMiddleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes through /api/auth/mobile-login even without cookie", async () => {
    const res = await request(makeApp()).post("/api/auth/mobile-login");
    expect(res.status).toBe(200);
  });

  it("passes through when Host is localhost", async () => {
    const res = await request(makeApp()).get("/api/health").set("Host", "localhost:3010");
    expect(res.status).toBe(200);
  });

  it("passes through when Host is 127.0.0.1", async () => {
    const res = await request(makeApp()).get("/api/health").set("Host", "127.0.0.1:3010");
    expect(res.status).toBe(200);
  });

  it("returns 401 on /api/* when Host is .ts.net without valid cookie", async () => {
    vi.mocked(auth.verifySessionCookie).mockReturnValue(false);
    const res = await request(makeApp()).get("/api/health").set("Host", "mac.foo.ts.net");
    expect(res.status).toBe(401);
  });

  it("passes /api/* when Host is .ts.net and cookie is valid", async () => {
    vi.mocked(auth.verifySessionCookie).mockReturnValue(true);
    const res = await request(makeApp()).get("/api/health").set("Host", "mac.foo.ts.net");
    expect(res.status).toBe(200);
  });

  it("passes HTML through on .ts.net without cookie, so SPA pairing gate can render", async () => {
    vi.mocked(auth.verifySessionCookie).mockReturnValue(false);
    const res = await request(makeApp()).get("/").set("Host", "mac.foo.ts.net");
    expect(res.status).toBe(200);
  });
});
