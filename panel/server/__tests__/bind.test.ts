import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("server bind", () => {
  it("listens on 127.0.0.1 only, not 0.0.0.0", () => {
    const src = readFileSync(resolve(__dirname, "../index.ts"), "utf8");
    expect(src).toMatch(/server\.listen\(\s*port\s*,\s*["']127\.0\.0\.1["']/);
    expect(src).not.toMatch(/server\.listen\(\s*port\s*\)/);
  });
});
