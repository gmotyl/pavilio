import { describe, it, expect } from "vitest";
import { sanitizeHostname } from "../hostname";

describe("sanitizeHostname", () => {
  it("lowercases and replaces non-alnum with -", () => {
    expect(sanitizeHostname("MacBook.local")).toBe("macbook-local");
  });
  it("strips trailing dashes", () => {
    expect(sanitizeHostname("greg-mac---")).toBe("greg-mac");
  });
  it("falls back to 'unknown' for empty input", () => {
    expect(sanitizeHostname("")).toBe("unknown");
  });
});
