import { describe, it, expect } from "vitest";

// The other half of the guard in server/__tests__/test-environment.test.ts:
// splitting the suites into two vitest projects must not cost the browser tests
// their DOM, nor the setup file that backs localStorage and sessionStorage.
describe("browser test environment", () => {
  it("runs in jsdom, not node", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
  });

  it("has the setup file's in-memory storage installed", () => {
    localStorage.setItem("panel:test-environment", "1");
    expect(localStorage.getItem("panel:test-environment")).toBe("1");
    sessionStorage.setItem("panel:test-environment", "2");
    expect(sessionStorage.getItem("panel:test-environment")).toBe("2");
  });
});
