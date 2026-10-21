import { describe, it, expect } from "vitest";
import { join } from "path";
import { isContextPathAllowed, isPlanPathAllowed } from "../../routes/projects.js";

// The read routes (`/context/read`, `/plans/read`) gate every path through these
// two predicates. The routes keep one 403 case each; every allow/deny rule is a
// row here.

const ROOT = join("/p", "projects", "alokai");

describe("isContextPathAllowed", () => {
  it.each<[string, string, string[], boolean]>([
    ["accepts CONTEXT.md at the project root", "/tmp/x/CONTEXT.md", ["/tmp/x"], true],
    ["accepts CONTEXT-MAP.md too", "/tmp/x/CONTEXT-MAP.md", ["/tmp/x"], true],
    ["accepts files under <root>/docs/adr/", "/tmp/x/docs/adr/0001-foo.md", ["/tmp/x"], true],
    ["accepts files under <root>/adr/", "/tmp/x/adr/0001-foo.md", ["/tmp/x"], true],
    ["rejects arbitrary file inside the root", "/tmp/x/src/index.ts", ["/tmp/x"], false],
    ["rejects a non-context markdown file inside the project", join(ROOT, "secret.md"), [ROOT], false],
    ["rejects paths outside all roots", "/etc/passwd", ["/tmp/x"], false],
    ["rejects null-byte in path", "/tmp/x/CONTEXT.md\0.md", ["/tmp/x"], false],
    // specs/
    ["allows a markdown file directly under <root>/specs/", join(ROOT, "specs", "checkout-tax.md"), [ROOT], true],
    [
      "rejects a markdown file nested deeper under specs/ (listing is top-level-only)",
      join(ROOT, "specs", "area", "nested.md"),
      [ROOT],
      false,
    ],
    ["rejects a sibling file named specs.md outside the specs dir", join(ROOT, "specs.md"), [ROOT], false],
    ["rejects non-markdown files anywhere (global extension check)", join(ROOT, "specs", "notes.txt"), [ROOT], false],
    ["rejects a specs path outside every allowlisted root", join("/elsewhere", "specs", "x.md"), [ROOT], false],
    ["still allows CONTEXT.md once specs/ is allowed (regression)", join(ROOT, "CONTEXT.md"), [ROOT], true],
    ["still allows adr files once specs/ is allowed (regression)", join(ROOT, "adr", "0001-x.md"), [ROOT], true],
  ])("%s", (_label, path, roots, expected) => {
    expect(isContextPathAllowed(path, roots)).toBe(expected);
  });
});

describe("isPlanPathAllowed", () => {
  it.each<[string, string, boolean]>([
    ["accepts a .md file under an allowed dir", "/tmp/x/plans/a.md", true],
    ["rejects the dir itself", "/tmp/x/plans", false],
    ["rejects a non-.md file", "/tmp/x/plans/a.txt", false],
    ["rejects a path outside all dirs", "/etc/passwd", false],
    ["rejects null-byte", "/tmp/x/plans/a.md\0", false],
  ])("%s", (_label, path, expected) => {
    expect(isPlanPathAllowed(path, ["/tmp/x/plans"])).toBe(expected);
  });
});
