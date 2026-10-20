import { describe, it, expect } from "vitest";

import { countTopLevelBullets } from "../tree";

describe("countTopLevelBullets", () => {
  it("counts unindented bullets outside fences", () => {
    expect(countTopLevelBullets("- a\n* b\n+ c\n  - nested\n-not a bullet\n")).toBe(3);
  });

  it("skips bullets inside fences indented up to three spaces", () => {
    const md = ["- one", "   ```", "- fenced", "   ```", "  ~~~md", "- also fenced", "  ~~~", "- two"].join("\n");
    expect(countTopLevelBullets(md)).toBe(2);
  });

  it("a fence line with an info string never closes a fence", () => {
    const md = ["```md", "- fenced", "```js", "- still fenced", "```", "- counted", "- counted too"].join("\n");
    expect(countTopLevelBullets(md)).toBe(2);
  });
});
