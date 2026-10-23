import { describe, it, expect } from "vitest";
import { splitFrontmatter } from "../frontmatter";

describe("splitFrontmatter", () => {
  it("parses fenced frontmatter behind a UTF-8 BOM", () => {
    const text = "﻿---\nkind: research\ntopic: tts\n---\n# Title\n";
    expect(splitFrontmatter(text)).toEqual({ data: { kind: "research", topic: "tts" }, body: "# Title\n" });
  });
});
