import { describe, it, expect } from "vitest";
import { renderQrSvg } from "../qr";

describe("renderQrSvg", () => {
  it("produces an svg string containing a path element", async () => {
    const svg = await renderQrSvg("https://mac.foo.ts.net/#mt=abc");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });
});
