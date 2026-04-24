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
  ensureToken: vi.fn(),
  getCurrentToken: vi.fn(),
}));
vi.mock("../../lib/lan", () => ({
  detectLanIp: vi.fn(),
  isWsl: vi.fn(() => false),
  getWslVmIp: vi.fn(() => null),
}));
vi.mock("../../lib/panel-listener", () => ({
  rebindPanel: vi.fn(),
  getCurrentBindHost: vi.fn(),
}));
vi.mock("../../config", () => ({
  getConfig: () => ({ port: 3010 }),
}));

import * as tailscale from "../../lib/tailscale";
import * as auth from "../../lib/mobile-auth";
import * as lan from "../../lib/lan";
import * as listener from "../../lib/panel-listener";
import mobileAccessRouter from "../mobile-access";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/mobile-access", mobileAccessRouter);
  return app;
}

const tailscaleOn = {
  state: "on" as const,
  selfHost: "mac.foo.ts.net",
  url: "https://mac.foo.ts.net",
};

describe("GET /api/mobile-access/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { tailscale, lan } envelope with tailscale qrUrl when on", async () => {
    vi.mocked(tailscale.detectTailscale).mockResolvedValue(tailscaleOn);
    vi.mocked(auth.getCurrentToken).mockReturnValue("T0KEN");
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("127.0.0.1");

    const res = await request(makeApp()).get("/api/mobile-access/status");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tailscale: {
        state: "on",
        url: "https://mac.foo.ts.net",
        qrUrl: "https://mac.foo.ts.net/#mt=T0KEN",
      },
      lan: {
        state: "off",
        lanIp: "192.168.1.42",
      },
    });
  });

  it("reports lan.state='on' when bind host is 0.0.0.0 and LAN IP detected", async () => {
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue("T0KEN");
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("0.0.0.0");

    const res = await request(makeApp()).get("/api/mobile-access/status");

    expect(res.body.lan).toEqual({
      state: "on",
      lanIp: "192.168.1.42",
      url: "http://192.168.1.42:3010",
      qrUrl: "http://192.168.1.42:3010/#mt=T0KEN",
    });
  });

  it("reports lan.lanIp=null when no LAN interface detected", async () => {
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue("T0KEN");
    vi.mocked(lan.detectLanIp).mockReturnValue(null);
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("127.0.0.1");

    const res = await request(makeApp()).get("/api/mobile-access/status");

    expect(res.body.lan).toEqual({ state: "off", lanIp: null });
  });
});

describe("POST /api/mobile-access/enable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ensures a token, runs enableServe, returns { tailscale, lan }", async () => {
    vi.mocked(auth.ensureToken).mockResolvedValue("EXISTING");
    vi.mocked(tailscale.enableServe).mockResolvedValue(tailscaleOn);
    vi.mocked(auth.getCurrentToken).mockReturnValue("EXISTING");
    vi.mocked(lan.detectLanIp).mockReturnValue(null);
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("127.0.0.1");

    const res = await request(makeApp()).post("/api/mobile-access/enable");

    expect(res.status).toBe(200);
    expect(auth.ensureToken).toHaveBeenCalled();
    expect(auth.rotateToken).not.toHaveBeenCalled();
    expect(tailscale.enableServe).toHaveBeenCalled();
    expect(res.body.tailscale.qrUrl).toBe("https://mac.foo.ts.net/#mt=EXISTING");
    expect(res.body.lan).toEqual({ state: "off", lanIp: null });
  });
});

describe("POST /api/mobile-access/disable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs disableServe; preserves token; returns envelope", async () => {
    vi.mocked(tailscale.disableServe).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue("STILL_HERE");
    vi.mocked(lan.detectLanIp).mockReturnValue(null);
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("127.0.0.1");

    const res = await request(makeApp()).post("/api/mobile-access/disable");

    expect(res.status).toBe(200);
    expect(tailscale.disableServe).toHaveBeenCalled();
    expect(auth.rotateToken).not.toHaveBeenCalled();
    expect(auth.ensureToken).not.toHaveBeenCalled();
    expect(res.body.tailscale.state).toBe("off");
  });
});

describe("POST /api/mobile-access/rotate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rotates token and reports both channels with fresh qrUrl", async () => {
    vi.mocked(auth.rotateToken).mockResolvedValue("FRESH");
    vi.mocked(tailscale.detectTailscale).mockResolvedValue(tailscaleOn);
    vi.mocked(auth.getCurrentToken).mockReturnValue("FRESH");
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("0.0.0.0");

    const res = await request(makeApp()).post("/api/mobile-access/rotate");

    expect(res.status).toBe(200);
    expect(auth.rotateToken).toHaveBeenCalled();
    expect(tailscale.enableServe).not.toHaveBeenCalled();
    expect(tailscale.disableServe).not.toHaveBeenCalled();
    expect(res.body.tailscale.qrUrl).toBe("https://mac.foo.ts.net/#mt=FRESH");
    expect(res.body.lan.qrUrl).toBe("http://192.168.1.42:3010/#mt=FRESH");
  });
});

describe("POST /api/mobile-access/lan/enable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebinds to 0.0.0.0, ensures token, returns lan.state=on", async () => {
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(auth.ensureToken).mockResolvedValue("T");
    vi.mocked(listener.rebindPanel).mockResolvedValue();
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("0.0.0.0");
    vi.mocked(auth.getCurrentToken).mockReturnValue("T");
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });

    const res = await request(makeApp()).post("/api/mobile-access/lan/enable");

    expect(res.status).toBe(200);
    expect(auth.ensureToken).toHaveBeenCalled();
    expect(listener.rebindPanel).toHaveBeenCalledWith("0.0.0.0");
    expect(res.body.lan).toEqual({
      state: "on",
      lanIp: "192.168.1.42",
      url: "http://192.168.1.42:3010",
      qrUrl: "http://192.168.1.42:3010/#mt=T",
    });
  });

  it("does not rebind when no LAN interface; returns lan.lanIp=null", async () => {
    vi.mocked(lan.detectLanIp).mockReturnValue(null);
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue(null);

    const res = await request(makeApp()).post("/api/mobile-access/lan/enable");

    expect(res.status).toBe(200);
    expect(listener.rebindPanel).not.toHaveBeenCalled();
    expect(res.body.lan).toEqual({ state: "off", lanIp: null });
  });

  it("surfaces rebind failure as 500 with lan.state=off", async () => {
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(auth.ensureToken).mockResolvedValue("T");
    vi.mocked(listener.rebindPanel).mockRejectedValue(new Error("Rebind to 0.0.0.0 failed: EADDRINUSE"));
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue("T");

    const res = await request(makeApp()).post("/api/mobile-access/lan/enable");

    expect(res.status).toBe(500);
    expect(res.body.lan.state).toBe("off");
    expect(res.body.error).toMatch(/EADDRINUSE/);
  });
});

describe("POST /api/mobile-access/lan/disable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebinds to 127.0.0.1 and returns lan.state=off", async () => {
    vi.mocked(listener.rebindPanel).mockResolvedValue();
    vi.mocked(listener.getCurrentBindHost).mockReturnValue("127.0.0.1");
    vi.mocked(lan.detectLanIp).mockReturnValue("192.168.1.42");
    vi.mocked(tailscale.detectTailscale).mockResolvedValue({ state: "off", selfHost: "x" });
    vi.mocked(auth.getCurrentToken).mockReturnValue("T");

    const res = await request(makeApp()).post("/api/mobile-access/lan/disable");

    expect(res.status).toBe(200);
    expect(listener.rebindPanel).toHaveBeenCalledWith("127.0.0.1");
    expect(res.body.lan).toEqual({ state: "off", lanIp: "192.168.1.42" });
  });
});

describe("loopback guard", () => {
  it("rejects non-loopback remoteAddress with 403", () => {
    const router = mobileAccessRouter;
    const mw = (router as unknown as { stack: Array<{ name: string; handle: unknown }> })
      .stack.find((l) => l.name === "loopbackOnly")?.handle as
      | ((req: unknown, res: unknown, next: unknown) => void)
      | undefined;
    expect(mw).toBeTypeOf("function");
    const req = { socket: { remoteAddress: "192.168.1.5" } };
    let status = 0;
    let body: unknown;
    const res = {
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      },
    };
    const next = vi.fn();
    mw!(req, res, next);
    expect(status).toBe(403);
    expect(body).toEqual({ error: "loopback only" });
    expect(next).not.toHaveBeenCalled();
  });
});
