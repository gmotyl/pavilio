import { describe, it, expect } from "vitest";
import { synthesizeAddDiff } from "../git";

describe("synthesizeAddDiff", () => {
  it("renders every content line as an add line", () => {
    const out = synthesizeAddDiff("foo.ts", "alpha\nbeta\ngamma\n");
    expect(out).toContain("diff --git a/foo.ts b/foo.ts");
    expect(out).toContain("new file mode 100644");
    expect(out).toContain("--- /dev/null");
    expect(out).toContain("+++ b/foo.ts");
    expect(out).toContain("@@ -0,0 +1,3 @@");
    expect(out).toContain("+alpha");
    expect(out).toContain("+beta");
    expect(out).toContain("+gamma");
  });

  it("omits the trailing-newline empty line from the hunk count", () => {
    const withTrailing = synthesizeAddDiff("a", "one\ntwo\n");
    const withoutTrailing = synthesizeAddDiff("a", "one\ntwo");
    expect(withTrailing).toContain("@@ -0,0 +1,2 @@");
    expect(withoutTrailing).toContain("@@ -0,0 +1,2 @@");
  });

  it("handles empty content as a zero-line hunk", () => {
    const out = synthesizeAddDiff("empty", "");
    expect(out).toContain("@@ -0,0 +1,0 @@");
  });

  it("preserves path in the diff header", () => {
    const out = synthesizeAddDiff("nested/path/file.tsx", "x");
    expect(out).toContain("diff --git a/nested/path/file.tsx b/nested/path/file.tsx");
    expect(out).toContain("+++ b/nested/path/file.tsx");
  });
});
