import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `edge-tts-universal@1.4.0` only works against Microsoft's endpoint with
 * `panel/patches/edge-tts-universal@1.4.0.patch` applied (Sec-MS-GEC v2 token,
 * fail fast on a refused handshake). The patch is applied by the package
 * manager at install time, so an install that skipped it — a workspace synced
 * without the patch, a pnpm field pnpm did not read — leaves speech silently
 * broken while every unit test that mocks the socket still passes. This reads
 * the build the panel actually ships and fails if the patch is missing.
 */

// The browser build is what the panel bundles; the marker is a string only the
// patch introduces, in the error a refused handshake now rejects with.
const PATCH_MARKER = "closed before it opened";

function installedBrowserBuild(): string {
  const require = createRequire(import.meta.url);
  // The package's exports map hides package.json, so resolve its entry point,
  // which sits in dist/ beside the browser build.
  const entry = require.resolve("edge-tts-universal");
  return readFileSync(join(dirname(entry), "browser.js"), "utf8");
}

describe("edge-tts-universal pnpm patch", () => {
  it("is applied to the installed browser build", () => {
    expect(
      installedBrowserBuild().includes(PATCH_MARKER),
      "edge-tts-universal is installed without panel/patches/edge-tts-universal@1.4.0.patch — re-run pnpm install",
    ).toBe(true);
  });
});
