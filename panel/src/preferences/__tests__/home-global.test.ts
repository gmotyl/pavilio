import { describe, it, expect, afterEach, vi } from "vitest";
import { normalizeRepoScope } from "../types";

/**
 * `window.__PAVILIO_HOME__` is injected by `GET /api/preferences.js`, which
 * always serializes `os.homedir()` — a string. This file pins what happens
 * when it is anything else: another script on the page assigning it, a
 * hand-edited bundle, a future server bug. The rule is "ignore it and fall
 * back", never "expand a tilde against `[object Object]`" and never throw
 * while computing a storage key.
 *
 * A separate file from `codecs.test.ts` on purpose: that one covers the
 * well-formed injection, this one only the malformed cases.
 */
// `unknown`, not an intersection with `typeof globalThis`: types.ts declares
// the global as `string | undefined`, and intersecting narrows it back so the
// junk assignments below will not typecheck. Widening through `unknown` is
// the point of this file — it pins what happens when the value is NOT a string.
type HomeGlobals = { __PAVILIO_HOME__?: unknown };
const globals = globalThis as unknown as HomeGlobals;

afterEach(() => {
  delete globals.__PAVILIO_HOME__;
  vi.unstubAllEnvs();
});

describe("a non-string __PAVILIO_HOME__ injection", () => {
  const junk: unknown[] = [42, true, null, { home: "/root" }, ["/root"], () => "/root"];

  it("is ignored in favour of process.env.HOME", () => {
    vi.stubEnv("HOME", "/root");
    for (const value of junk) {
      globals.__PAVILIO_HOME__ = value;
      expect(normalizeRepoScope("~/git/prv/pavilio"), `for ${String(value)}`).toBe(
        "/root/git/prv/pavilio",
      );
    }
  });

  it("leaves the tilde alone rather than expanding against it", () => {
    // No usable home anywhere: the path must come back untouched, not
    // expanded against a stringified object.
    vi.stubEnv("HOME", "");
    for (const value of junk) {
      globals.__PAVILIO_HOME__ = value;
      const key = normalizeRepoScope("~/git/prv/pavilio");
      expect(key, `for ${String(value)}`).not.toContain("object");
      expect(key, `for ${String(value)}`).not.toContain("undefined");
    }
  });

  it("an empty string counts as no home at all", () => {
    // `""` is a string, so a naive `typeof` check would accept it and turn
    // `~/x` into `/x` — a different key from every other runtime's.
    globals.__PAVILIO_HOME__ = "";
    vi.stubEnv("HOME", "/root");
    expect(normalizeRepoScope("~/git/prv/pavilio")).toBe("/root/git/prv/pavilio");
  });
});
