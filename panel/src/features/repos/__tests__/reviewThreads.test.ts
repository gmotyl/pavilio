import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../../../../server/lib/prs/provider";
import { commentCount, groupThreads } from "../reviewThreads";

const c = (id: number, over: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  replyTo: null,
  path: "src/a.ts",
  line: 14,
  side: "new",
  author: "octo",
  body: `c${id}`,
  createdAt: `2026-11-23T10:${String(id).padStart(2, "0")}:00Z`,
  url: `https://example.test/${id}`,
  ...over,
});

describe("reviewThreads", () => {
  it("groupThreads anchors replies on their root", () => {
    const root = c(1);
    // Replies carry their own (possibly different) line; they must follow the root.
    const r1 = c(2, { replyTo: 1, line: 99, side: "old" });
    const r2 = c(3, { replyTo: 1, line: 7 });
    const threads = groupThreads([r2, root, r1]);
    const file = threads.get("src/a.ts")!;
    expect([...file.keys()]).toEqual(["new:14"]);
    const t = file.get("new:14")!;
    expect(t.anchor).toEqual({ side: "new", line: 14 });
    expect(t.comments.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("groupThreads drops orphan replies", () => {
    const threads = groupThreads([c(2, { replyTo: 42 }), c(3, { replyTo: 42, path: "src/b.ts" })]);
    expect(threads.size).toBe(0);
  });

  it("groupThreads merges roots on the same line", () => {
    const later = c(5);
    const earlier = c(1);
    const reply = c(3, { replyTo: 5 });
    const other = c(2, { side: "old" });
    const file = groupThreads([later, reply, earlier, other]).get("src/a.ts")!;
    expect(file.size).toBe(2);
    expect(file.get("new:14")!.comments.map((x) => x.id)).toEqual([1, 3, 5]);
    expect(file.get("old:14")!.comments.map((x) => x.id)).toEqual([2]);
  });

  it("groupThreads orders comments with the same time by id", () => {
    const at = "2026-11-23T10:00:00Z";
    const t = groupThreads([c(3, { replyTo: 1, createdAt: at }), c(2, { replyTo: 1, createdAt: at }), c(1, { createdAt: at })])
      .get("src/a.ts")!
      .get("new:14")!;
    expect(t.comments.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("commentCount sums a file's comments", () => {
    const file = groupThreads([c(1), c(2, { replyTo: 1 }), c(3, { line: 20 })]).get("src/a.ts");
    expect(file?.size).toBe(2);
    expect(commentCount(file)).toBe(3);
    expect(commentCount(undefined)).toBe(0);
  });
});
