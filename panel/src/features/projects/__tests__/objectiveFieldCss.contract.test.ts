import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The objective box draws its placeholder tint on a mirror layer behind a
 * transparent-text textarea, so the two must wrap the same text at the same
 * width and show the same lines. jsdom lays nothing out, so this pins the
 * declarations in the shipped `src/index.css` that keep them aligned:
 *
 * - the textarea cannot be resized by hand — a dragged height leaves the
 *   mirror behind (the box grows with its content instead);
 * - both reserve the same scrollbar gutter, so a scrollbar appearing on the
 *   textarea does not narrow its lines while the mirror's stay wide;
 * - the mirror clips instead of growing a scrollbar of its own — its scroll
 *   position is driven from the textarea's.
 */

const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8");

/** The declarations of every top-level rule whose selector list includes `selector`. */
function declarations(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (!list.includes(selector)) continue;
    for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe("the objective box's mirror stays aligned", () => {
  it("the textarea is not resizable and grows with its content", () => {
    const box = declarations(".run-banner-objective");
    expect(box.get("resize")).toBe("none");
    expect(box.get("field-sizing")).toBe("content");
  });

  it("the textarea and the mirror reserve the same scrollbar gutter", () => {
    expect(declarations(".objective-field > .run-banner-objective").get("scrollbar-gutter")).toBe(
      "stable",
    );
    expect(declarations(".objective-field-overlay").get("scrollbar-gutter")).toBe("stable");
  });

  it("the mirror clips rather than scrolling on its own", () => {
    expect(declarations(".objective-field-overlay").get("overflow")).toBe("hidden");
  });

  it("the resolved preview is visually hidden but read", () => {
    const preview = declarations(".objective-field-preview");
    expect(preview.get("position")).toBe("absolute");
    expect(preview.get("clip-path")).toBe("inset(50%)");
    expect(preview.get("display")).toBeUndefined();
  });
});
