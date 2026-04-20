import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/mobile-auth", () => ({
  verifyLoginToken: vi.fn(),
  issueSessionCookie: vi.fn((res) => res.cookie("mobile_session", "signed.value", { httpOnly: true })),
}));

import * as auth from "../../lib/mobile-auth";
import authMobileRouter from "../auth-mobile";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authMobileRouter);
  return app;
}

describe("POST /api/auth/mobile-login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts valid token and sets cookie", async () => {
    vi.mocked(auth.verifyLoginToken).mockReturnValue(true);
    const res = await request(makeApp()).post("/api/auth/mobile-login").send({ token: "GOOD" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toContain("mobile_session=");
  });

  it("rejects invalid token with 401", async () => {
    vi.mocked(auth.verifyLoginToken).mockReturnValue(false);
    const res = await request(makeApp()).post("/api/auth/mobile-login").send({ token: "BAD" });
    expect(res.status).toBe(401);
  });

  it("rejects missing body with 400", async () => {
    const res = await request(makeApp()).post("/api/auth/mobile-login").send({});
    expect(res.status).toBe(400);
  });
});
