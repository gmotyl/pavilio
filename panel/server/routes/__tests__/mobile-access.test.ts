import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/tailscale", () => ({
  detectTailscale: vi.fn(),
  enableServe: vi.fn(),
  disableServe: vi.fn(),
}));
vi.mock("../../lib/mobile-auth", () => ({
  rotateToken: vi.fn(),
  clearToken: vi.fn(),
  getCurrentToken: vi.fn(),
}));
vi.mock("../../config", () => ({
  getConfig: () => ({ port: 3010 }),
}));

import * as tailscale from "../../lib/tailscale";
import * as auth from "../../lib/mobile-auth";
import mobileAccessRouter from "../mobile-access";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/mobile-access", mobileAccessRouter);
  return app;
}

describe("GET /api/mobile-access/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns status; when on, includes qrUrl with fragment", async () => {
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({
      state: "on",
      selfHost: "mac.foo.ts.net",
      url: "https://mac.foo.ts.net",
    });
    vi.mocked(auth.getCurrentToken).mockReturnValue("T0KEN");
    const res = await request(makeApp()).get("/api/mobile-access/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: "on",
      url: "https://mac.foo.ts.net",
      qrUrl: "https://mac.foo.ts.net/#mt=T0KEN",
    });
  });
});

describe("POST /api/mobile-access/enable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rotates token then runs enableServe", async () => {
    vi.mocked(auth.rotateToken).mockResolvedValue("NEWTOKEN");
    vi.mocked(tailscale.enableServe).mockResolvedValue({
      state: "on",
      selfHost: "mac.foo.ts.net",
      url: "https://mac.foo.ts.net",
    });
    vi.mocked(auth.getCurrentToken).mockReturnValue("NEWTOKEN");
    const res = await request(makeApp()).post("/api/mobile-access/enable");
    expect(res.status).toBe(200);
    expect(auth.rotateToken).toHaveBeenCalled();
    expect(tailscale.enableServe).toHaveBeenCalled();
    expect(res.body.qrUrl).toBe("https://mac.foo.ts.net/#mt=NEWTOKEN");
  });
});

describe("POST /api/mobile-access/disable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs disableServe then clears token", async () => {
    vi.mocked(tailscale.disableServe).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.clearToken).mockResolvedValue();
    vi.mocked(auth.getCurrentToken).mockReturnValue(null);
    const res = await request(makeApp()).post("/api/mobile-access/disable");
    expect(res.status).toBe(200);
    expect(tailscale.disableServe).toHaveBeenCalled();
    expect(auth.clearToken).toHaveBeenCalled();
  });
});

describe("loopback guard", () => {
  it("rejects non-loopback remoteAddress with 403", () => {
    const router = mobileAccessRouter;
    const mw = (router as any).stack.find((l: any) => l.name === "loopbackOnly")?.handle;
    expect(mw).toBeTypeOf("function");
    const req = { socket: { remoteAddress: "192.168.1.5" } } as any;
    let status = 0;
    let body: unknown;
    const res = {
      status(s: number) { status = s; return this; },
      json(b: unknown) { body = b; return this; },
    } as any;
    const next = vi.fn();
    mw!(req, res, next);
    expect(status).toBe(403);
    expect(body).toEqual({ error: "loopback only" });
    expect(next).not.toHaveBeenCalled();
  });
});
