import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "panel-auth-"));
  vi.stubEnv("PANEL_AUTH_STATE_DIR", tmp);
  vi.resetModules();
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("mobile-auth state", () => {
  it("loadAuthState creates file with generation 0 and signingKey", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    expect(mod.getCurrentGeneration()).toBe(0);
    expect(mod.getCurrentToken()).toBeNull();
  });

  it("rotateToken bumps generation and returns a fresh token", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    const tokenA = await mod.rotateToken();
    expect(mod.getCurrentGeneration()).toBe(1);
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const tokenB = await mod.rotateToken();
    expect(mod.getCurrentGeneration()).toBe(2);
    expect(tokenB).not.toBe(tokenA);
  });

  it("clearToken bumps generation and nulls the token", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    await mod.rotateToken();
    await mod.clearToken();
    expect(mod.getCurrentGeneration()).toBe(2);
    expect(mod.getCurrentToken()).toBeNull();
  });

  it("ensureToken mints once when missing, reuses afterwards", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    expect(mod.getCurrentToken()).toBeNull();
    const first = await mod.ensureToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mod.getCurrentGeneration()).toBe(1);
    const second = await mod.ensureToken();
    expect(second).toBe(first);
    expect(mod.getCurrentGeneration()).toBe(1);
  });

  it("state persists across module reloads", async () => {
    let mod = await import("../mobile-auth");
    await mod.loadAuthState();
    const token = await mod.rotateToken();
    vi.resetModules();
    mod = await import("../mobile-auth");
    await mod.loadAuthState();
    expect(mod.getCurrentGeneration()).toBe(1);
    expect(mod.getCurrentToken()).toBe(token);
  });
});

describe("mobile-auth token + cookie", () => {
  it("verifyLoginToken accepts current token, rejects others", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    const t = await mod.rotateToken();
    expect(mod.verifyLoginToken(t)).toBe(true);
    expect(mod.verifyLoginToken("wrong")).toBe(false);
    expect(mod.verifyLoginToken("")).toBe(false);
  });

  it("verifyLoginToken returns false if no active token", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    expect(mod.verifyLoginToken("anything")).toBe(false);
  });

  it("cookie issued at gen N is rejected after rotation (gen N+1)", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    await mod.rotateToken();
    const res: any = {
      headers: {} as Record<string, string>,
      cookie(name: string, value: string) {
        this.headers[name] = value;
      },
    };
    mod.issueSessionCookie(res);
    const issued = res.headers.mobile_session as string;
    const req: any = { headers: { cookie: `mobile_session=${issued}` } };
    expect(mod.verifySessionCookie(req)).toBe(true);

    await mod.rotateToken();
    expect(mod.verifySessionCookie(req)).toBe(false);
  });

  it("tampered cookie is rejected", async () => {
    const mod = await import("../mobile-auth");
    await mod.loadAuthState();
    await mod.rotateToken();
    const req: any = { headers: { cookie: "mobile_session=garbage.bad" } };
    expect(mod.verifySessionCookie(req)).toBe(false);
  });
});
