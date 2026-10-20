import { describe, it, expect } from "vitest";

import { decodePathSegments, viewFilePath } from "../viewRoute";

describe("viewRoute", () => {
  it("decodes each segment of an encoded route path", () => {
    expect(decodePathSegments("p/wiki/a%20b%23c%3Fd.md")).toBe("p/wiki/a b#c?d.md");
    expect(viewFilePath("/view/p/notes/a%20b.md")).toBe("p/notes/a b.md");
  });

  it("keeps a raw path as is and a malformed escape verbatim", () => {
    expect(viewFilePath("/view/p/notes/a b.md")).toBe("p/notes/a b.md");
    expect(decodePathSegments("p/100%/x%E0%A4%A.md")).toBe("p/100%/x%E0%A4%A.md");
  });
});
