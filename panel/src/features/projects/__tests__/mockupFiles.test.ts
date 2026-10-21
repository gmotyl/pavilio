import { describe, it, expect } from "vitest";
import {
  MOCKUP_MAX_SOURCE_BYTES,
  normaliseMockupSlug,
  viewerReadUrl,
} from "../mockupFiles";

// Mirrors server/lib/__tests__/mockup-import.test.ts so the dialog pre-fill
// matches the name the server writes.
describe("normaliseMockupSlug", () => {
  it("normalises the slug", () => {
    expect(normaliseMockupSlug("Account Details / Mobile!!")).toBe("account-details-mobile");
    expect(normaliseMockupSlug("  --Frame__12--  ")).toBe("frame-12");
    expect(normaliseMockupSlug("a".repeat(80))).toHaveLength(60);
    expect(normaliseMockupSlug(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });

  it("strips diacritics instead of turning them into dashes", () => {
    expect(normaliseMockupSlug("Zażółć gęślą")).toBe("zazolc-gesla");
    expect(normaliseMockupSlug("ŁÓDŹ Straße")).toBe("lodz-strasse");
    expect(normaliseMockupSlug("Søren Đorđe café")).toBe("soren-dorde-cafe");
  });
});

// Every viewer reads through this — `useFileViewer` (the project tabs) and
// `MarkdownViewer` (the `/view` route) — so their tests keep only one image
// read each, as wiring.
describe("viewerReadUrl", () => {
  it("reads a raster's meta only, an html/svg's source capped, anything else plain", () => {
    const read = (path: string) => viewerReadUrl(path, `/api/files/read/${path}`);
    // A raster's bytes are never decoded as utf-8 text.
    expect(read("p/mockups/hero.PNG")).toBe("/api/files/read/p/mockups/hero.PNG?meta=1");
    // An svg is an image, but its source is text worth copying — capped, so a
    // huge existing file is not read in full just for Copy content.
    const capped = `maxBytes=${MOCKUP_MAX_SOURCE_BYTES}`;
    expect(read("p/mockups/icon.svg")).toBe(`/api/files/read/p/mockups/icon.svg?${capped}`);
    expect(read("p/mockups/boot.html")).toBe(`/api/files/read/p/mockups/boot.html?${capped}`);
    expect(read("p/notes/a.md")).toBe("/api/files/read/p/notes/a.md");
    // An existing query string is extended, not replaced.
    expect(viewerReadUrl("a.png", "/r?root=x")).toBe("/r?root=x&meta=1");
    expect(viewerReadUrl("a.svg", "/r?root=x")).toBe(`/r?root=x&${capped}`);
  });
});
