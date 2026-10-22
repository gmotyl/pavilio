import { describe, it, expect } from "vitest";

import { panelLink } from "../panel-link";

describe("panelLink", () => {
  it("panelLink builds the wiki tab route for wiki pages", () => {
    expect(panelLink("pavilio/wiki/sources/progress-2026-10-16-adopt-anytts-execute.md")).toBe(
      "/project/pavilio/wiki?file=pavilio%2Fwiki%2Fsources%2Fprogress-2026-10-16-adopt-anytts-execute.md",
    );
    expect(panelLink("pavilio/wiki/index.md")).toBe("/project/pavilio/wiki?file=pavilio%2Fwiki%2Findex.md");
  });

  it("panelLink builds the view route for other files", () => {
    expect(panelLink("pavilio/progress/2026-10-19-x.md")).toBe("/view/pavilio/progress/2026-10-19-x.md");
    // `wiki` that is not the second segment is not the project's wiki.
    expect(panelLink("pavilio/notes/wiki/a.md")).toBe("/view/pavilio/notes/wiki/a.md");
  });

  it("panelLink encodes reserved characters like linkHref", () => {
    expect(panelLink("my proj/notes/a #1?.md")).toBe("/view/my%20proj/notes/a%20%231%3F.md");
    expect(panelLink("my proj/wiki/a #1?.md")).toBe(
      "/project/my%20proj/wiki?file=my%20proj%2Fwiki%2Fa%20%231%3F.md",
    );
    for (const link of [panelLink("p/wiki/x.md"), panelLink("p/x.md"), panelLink("//evil.com/x.md")]) {
      expect(link.startsWith("/")).toBe(true);
      expect(link.startsWith("//")).toBe(false);
      expect(link).not.toMatch(/^[a-z]+:/i);
    }
  });
});
