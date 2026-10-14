import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The type gate: `pnpm lint` typechecks both the client (tsconfig.json) and the
 * server (tsconfig.node.json) configs, runs in pre-push ahead of the test suite,
 * and is no longer part of `vite build`.
 */
const REPO_ROOT = resolve(__dirname, "../../..");

function scripts(manifest: string): Record<string, string> {
  return (
    JSON.parse(readFileSync(join(REPO_ROOT, manifest), "utf8")) as {
      scripts?: Record<string, string>;
    }
  ).scripts ?? {};
}

describe("type gate", () => {
  it("panel lint typechecks both the client and the server config", () => {
    const lint = scripts("panel/package.json").lint ?? "";
    expect(lint).toMatch(/tsc\b[^&]*--noEmit[^&]*-p tsconfig\.json(\s|$)/);
    expect(lint).toMatch(/tsc\b[^&]*--noEmit[^&]*-p tsconfig\.node\.json(\s|$)/);
  });

  it("panel build does not typecheck", () => {
    const build = scripts("panel/package.json").build ?? "";
    expect(build).toContain("vite build");
    expect(build).not.toMatch(/\blint\b/);
    expect(build).not.toMatch(/\btsc\b/);
  });

  it("pre-push runs lint, then knip, before the test suite", () => {
    const hook = readFileSync(join(REPO_ROOT, "panel/.husky/pre-push"), "utf8");
    expect(hook).toMatch(/pnpm lint\s*&&\s*pnpm knip\s*&&\s*pnpm test/);
  });

  it("root lint delegates to the panel", () => {
    expect(scripts("package.json").lint).toBe("pnpm -C panel lint");
  });
});
