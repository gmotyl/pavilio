import { describe, expect, it } from "vitest";
import { applyPronunciation } from "../pronunciation";

describe("applyPronunciation", () => {
  it("substitutes a mapped term case-insensitively", () => {
    expect(applyPronunciation("benchmark")).toBe("benczmark");
    expect(applyPronunciation("Benchmark")).toBe("benczmark");
    expect(applyPronunciation("BENCHMARK")).toBe("benczmark");
    expect(applyPronunciation("React")).toBe("reakt");
    // Acronyms match as a standalone word only, but just as case-insensitively.
    expect(applyPronunciation("API")).toBe("ej-pi-aj");
    expect(applyPronunciation("api")).toBe("ej-pi-aj");
    // ...and never as a prefix of a real word.
    expect(applyPronunciation("apiary")).toBe("apiary");
  });

  it("longest key wins over a shorter overlapping key", () => {
    expect(applyPronunciation("Codex")).toBe("kodeks"); // not `code` + "x"
    expect(applyPronunciation("Cloudflare")).toBe("klałdfler"); // not `cloud` + "flare"
    expect(applyPronunciation("pull request")).toBe("pul rikłest"); // phrase beats its words
  });

  it("stem match preserves Polish inflection", () => {
    expect(applyPronunciation("benchmarki")).toBe("benczmarki");
    expect(applyPronunciation("benchmarków")).toBe("benczmarków");
    expect(applyPronunciation("commitowanego")).toBe("komitowanego");
    expect(applyPronunciation("frameworku")).toBe("frejmłerku");
    // A key that is not at a word start is left alone.
    expect(applyPronunciation("arbenchmark")).toBe("arbenchmark");
  });
});
