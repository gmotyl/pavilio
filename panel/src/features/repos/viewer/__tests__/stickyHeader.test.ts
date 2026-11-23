import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// jsdom has no layout, so the CSS contract is checked as text: a sticky `top: 0` header pins at
// its scroll container's padding edge, so a padded scroller leaves a strip of code above it.
const here = dirname(fileURLToPath(import.meta.url));
const css = (rel: string) => readFileSync(join(here, rel), "utf8");

/** Declarations of every rule whose selector is exactly `selector`, later ones winning. */
function rule(text: string, selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: Record<string, string> = {};
  for (const m of text.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))) {
    for (const d of m[1].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  if (!Object.keys(out).length) throw new Error(`no rule for ${selector}`);
  return out;
}

const topPadding = (decls: Record<string, string>) => {
  if (decls["padding-top"]) return decls["padding-top"];
  const p = (decls.padding ?? "0").split(/\s+/);
  return p[0];
};

describe("file viewer sticky header", () => {
  it("sticks at top 0", () => {
    const h = rule(css("../FileViewer.css"), ".fv-header");
    expect(h.position).toBe("sticky");
    expect(h.top).toBe("0");
  });

  it.each([
    ["../../Code.css", ".cv-viewer"],
    ["../../Review.css", ".rv-main"],
  ])("%s %s scroll container has no top padding above the header", (file, selector) => {
    const decls = rule(css(file), selector);
    expect(decls.overflow).toBe("auto");
    expect(topPadding(decls)).toMatch(/^0(px)?$/);
  });
});
