import { describe, it, expect } from "vitest";
import { join } from "path";
import { isContextPathAllowed } from "../routes/projects.js";

const ROOT = join("/p", "projects", "alokai");
const ALLOWLIST = [ROOT];

describe("isContextPathAllowed — specs/", () => {
  it("allows a markdown file directly under <root>/specs/", () => {
    expect(isContextPathAllowed(join(ROOT, "specs", "checkout-tax.md"), ALLOWLIST)).toBe(true);
  });

  it("rejects non-markdown files under specs/", () => {
    expect(isContextPathAllowed(join(ROOT, "specs", "notes.txt"), ALLOWLIST)).toBe(false);
  });

  it("rejects the specs dir itself", () => {
    expect(isContextPathAllowed(join(ROOT, "specs"), ALLOWLIST)).toBe(false);
  });

  it("rejects a specs path outside every allowlisted root", () => {
    expect(isContextPathAllowed(join("/elsewhere", "specs", "x.md"), ALLOWLIST)).toBe(false);
  });

  it("still allows CONTEXT.md and adr files (regression)", () => {
    expect(isContextPathAllowed(join(ROOT, "CONTEXT.md"), ALLOWLIST)).toBe(true);
    expect(isContextPathAllowed(join(ROOT, "adr", "0001-x.md"), ALLOWLIST)).toBe(true);
  });
});
