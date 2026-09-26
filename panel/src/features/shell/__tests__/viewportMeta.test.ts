import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// index.html lives at the package root, two levels above this test file's
// directory (`src/features/shell/__tests__/`), so panel/index.html.
const indexHtmlPath = resolve(__dirname, "../../../../index.html");

describe("viewport meta", () => {
  it("asks the keyboard to resize the layout", () => {
    const html = readFileSync(indexHtmlPath, "utf-8");
    const match = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(match).not.toBeNull();
    const content = match![1];
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1.0");
    expect(content).toContain("interactive-widget=resizes-content");
  });
});
