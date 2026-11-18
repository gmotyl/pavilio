import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { readGroup, projectGroup, rewriteGroup } from "../group";
import { readProject } from "../../discovery";
import { splitFrontmatter } from "../frontmatter";

let projectsDir = "";

function write(rel: string, text: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "project-group-"));
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
});

describe("project group", () => {
  it("reads a trimmed group", () => {
    expect(readGroup({ group: "  InfoPoly " })).toBe("InfoPoly");
    write("a/PROJECT.md", "---\ngroup: InfoPoly\n---\n# A\n");
    expect(projectGroup(projectsDir, "a")).toBe("InfoPoly");
  });

  it("missing empty or non-string group is null", () => {
    expect(readGroup({})).toBeNull();
    expect(readGroup({ group: "   " })).toBeNull();
    expect(readGroup({ group: 42 })).toBeNull();
    expect(readGroup({ group: ["x"] })).toBeNull();
    write("b/PROJECT.md", "# B\n");
    expect(projectGroup(projectsDir, "b")).toBeNull();
    expect(projectGroup(projectsDir, "missing")).toBeNull();
  });

  it("rewrite replaces only the group line", () => {
    const text = "---\nkind: research\ngroup: Old\ntitle: x\n---\n# Body\ngroup: Old\n";
    expect(rewriteGroup(text, "New")).toBe(
      "---\nkind: research\ngroup: New\ntitle: x\n---\n# Body\ngroup: Old\n",
    );
    const noGroup = "---\nkind: research\n---\n# Body\n";
    expect(rewriteGroup(noGroup, "New")).toBe("---\nkind: research\ngroup: New\n---\n# Body\n");
  });

  it("rewrite to null removes the line", () => {
    const text = "---\nkind: research\ngroup: Old\n---\n# Body\n";
    expect(rewriteGroup(text, null)).toBe("---\nkind: research\n---\n# Body\n");
    expect(rewriteGroup("# Body\n", null)).toBe("# Body\n");
  });

  it("rewrite adds frontmatter when absent", () => {
    expect(rewriteGroup("# Body\n", "InfoPoly")).toBe("---\ngroup: InfoPoly\n---\n# Body\n");
  });

  it("rewrite quotes values YAML would not read back as the same string", () => {
    for (const v of ["true", "null", "123", "1.0", "-", ".inf", "~", "no", "a: b", "#x", "x #y", "'q'", " pad ", "0x1F", "[a]", "{a}", "*a", "&a", "!t", "@x", "a\"b", "plain name"]) {
      const out = rewriteGroup("---\nkind: research\n---\n# B\n", v);
      expect(splitFrontmatter(out).data).toEqual({ kind: "research", group: v });
    }
    expect(rewriteGroup("# B\n", "plain name")).toBe("---\ngroup: plain name\n---\n# B\n");
  });

  it("rewrite consumes multi-line group values", () => {
    const cases = [
      "---\ngroup: >\n  folded\n  text\nkind: research\n---\n# B\n",
      "---\ngroup: |\n  a\n\n  b\nkind: research\n---\n# B\n",
      "---\ngroup:\n  - a\n  - b\nkind: research\n---\n# B\n",
      "---\ngroup:\n- a\n- b\nkind: research\n---\n# B\n",
      "---\ngroup: long\n  continued\nkind: research\n---\n# B\n",
    ];
    for (const text of cases) {
      expect(splitFrontmatter(rewriteGroup(text, "New")).data).toEqual({ group: "New", kind: "research" });
      expect(rewriteGroup(text, null)).toBe("---\nkind: research\n---\n# B\n");
    }
  });

  it("rewrite handles duplicate group keys", () => {
    const text = "---\ngroup: A\nkind: research\ngroup: B\n---\n# B\n";
    expect(rewriteGroup(text, "New")).toBe("---\ngroup: New\nkind: research\n---\n# B\n");
    expect(rewriteGroup(text, null)).toBe("---\nkind: research\n---\n# B\n");
  });

  it("rewrite keeps CRLF and BOM when adding frontmatter", () => {
    expect(rewriteGroup("# B\r\nx\r\n", "G")).toBe("---\r\ngroup: G\r\n---\r\n# B\r\nx\r\n");
    expect(rewriteGroup("\uFEFF# B\n", "G")).toBe("\uFEFF---\ngroup: G\n---\n# B\n");
  });

  it("discovery attaches group to projects", () => {
    write("c/PROJECT.md", "---\nkind: project\ngroup: InfoPoly\n---\n# C\n");
    write("d/PROJECT.md", "# D\n");
    expect(readProject(projectsDir, "c").group).toBe("InfoPoly");
    expect(readProject(projectsDir, "d").group).toBeNull();
  });
});
