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
