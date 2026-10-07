import { describe, it, expect } from "vitest";
import { normaliseMockupSlug } from "../mockupFiles";

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
