import { describe, it, expect } from "vitest";
import {
  getLayoutPresets,
  expandPreset,
  reconcileLayout,
  dedupeLayout,
  mergeInColumn,
  joinOtherColumn,
  splitToNewColumn,
  swapInLayout,
  type ColumnLayout,
} from "../columnLayout";

describe("getLayoutPresets", () => {
  it("returns the documented rows for counts 1, 2, 3, 4, 5, 6, 7, 8, 10", () => {
    expect(getLayoutPresets(1)).toEqual([{ label: "Default", sizes: [1] }]);

    expect(getLayoutPresets(2)).toEqual([{ label: "Default", sizes: [1, 1] }]);

    expect(getLayoutPresets(3)).toEqual([
      { label: "Default", sizes: [1, 2] },
      { label: "Alt 1", sizes: [1, 1, 1] },
    ]);

    expect(getLayoutPresets(4)).toEqual([
      { label: "Default", sizes: [2, 2] },
      { label: "Alt 1", sizes: [1, 3] },
      { label: "Alt 2", sizes: [1, 1, 2] },
    ]);

    expect(getLayoutPresets(5)).toEqual([
      { label: "Default", sizes: [2, 3] },
      { label: "Alt 1", sizes: [1, 4] },
      { label: "Alt 2", sizes: [1, 1, 3] },
    ]);

    expect(getLayoutPresets(6)).toEqual([
      { label: "Default", sizes: [2, 2, 2] },
      { label: "Alt 1", sizes: [1, 5] },
      { label: "Alt 2", sizes: [1, 1, 4] },
    ]);

    expect(getLayoutPresets(7)).toEqual([
      { label: "Default", sizes: [3, 2, 2] },
      { label: "Alt 1", sizes: [1, 3, 3] },
    ]);

    expect(getLayoutPresets(8)).toEqual([
      { label: "Default", sizes: [3, 3, 2] },
      { label: "Alt 1", sizes: [1, 4, 3] },
    ]);

    expect(getLayoutPresets(10)).toEqual([
      { label: "Default", sizes: [4, 3, 3] },
      { label: "Alt 1", sizes: [1, 5, 4] },
    ]);
  });
});

describe("expandPreset", () => {
  it("produces weight-1 entries consumed in order", () => {
    expect(expandPreset(["a", "b", "c"], [1, 2])).toEqual([
      [{ sessionId: "a", weight: 1 }],
      [
        { sessionId: "b", weight: 1 },
        { sessionId: "c", weight: 1 },
      ],
    ]);
  });
});

describe("reconcileLayout", () => {
  it("returns the same reference when prevLayout is empty", () => {
    const prevLayout: ColumnLayout = [];
    expect(reconcileLayout(["A", "B"], prevLayout, ["A", "B"])).toBe(prevLayout);
  });

  it("drops a column emptied by a closed session", () => {
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ];
    expect(reconcileLayout(["A", "B", "C"], prevLayout, ["B", "C"])).toEqual([
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ]);
  });

  it("shrinks a shared column without touching sibling weights", () => {
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [
        { sessionId: "B", weight: 5 },
        { sessionId: "C", weight: 2 },
      ],
    ];
    expect(reconcileLayout(["A", "B", "C"], prevLayout, ["A", "C"])).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "C", weight: 2 }],
    ]);
  });

  it("appends a weight-1 entry to the last column for a new session", () => {
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ];
    expect(reconcileLayout(["A", "B"], prevLayout, ["A", "B", "C"])).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ]);
  });

  it("returns [] when every column is emptied", () => {
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ];
    expect(reconcileLayout(["A", "B"], prevLayout, [])).toEqual([]);
  });

  it("does not re-append an id that is already present in the layout", () => {
    // StrictMode replays the caller's updater, so reconcile can be handed a
    // layout that already carries the "new" id while prevOrder is still stale.
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ];
    expect(reconcileLayout(["A", "B"], prevLayout, ["A", "B", "C"])).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ]);
  });

  it("reconciling its own result is a no-op", () => {
    const prevOrder = ["A", "B"];
    const nextOrder = ["A", "B", "C"];
    const prevLayout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ];
    const first = reconcileLayout(prevOrder, prevLayout, nextOrder);
    const second = reconcileLayout(prevOrder, first, nextOrder);
    expect(second).toEqual(first);
  });
});

describe("dedupeLayout", () => {
  it("dedupeLayout keeps the first entry and drops later duplicates", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 3 },
        { sessionId: "B", weight: 1 },
      ],
      [
        { sessionId: "A", weight: 1 },
        { sessionId: "C", weight: 2 },
      ],
    ];
    expect(dedupeLayout(layout)).toEqual([
      [
        { sessionId: "A", weight: 3 },
        { sessionId: "B", weight: 1 },
      ],
      [{ sessionId: "C", weight: 2 }],
    ]);
  });

  it("dedupeLayout removes a column emptied by the repair", () => {
    const layout: ColumnLayout = [
      [{ sessionId: "A", weight: 2 }],
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ];
    expect(dedupeLayout(layout)).toEqual([
      [{ sessionId: "A", weight: 2 }],
      [{ sessionId: "B", weight: 1 }],
    ]);
  });

  it("dedupeLayout returns the same reference when there is nothing to repair", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 2 },
        { sessionId: "B", weight: 1 },
      ],
      [{ sessionId: "C", weight: 1 }],
    ];
    expect(dedupeLayout(layout)).toBe(layout);
  });
});

describe("mergeInColumn", () => {
  it("is a no-op when sessionId and targetId are in different columns", () => {
    const layout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ];
    expect(mergeInColumn(layout, "A", "B")).toBe(layout);
  });

  it("sums weights into the target's slot and appends the displaced session as a new column", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 2 },
        { sessionId: "B", weight: 3 },
      ],
    ];
    expect(mergeInColumn(layout, "A", "B")).toEqual([
      [{ sessionId: "A", weight: 5 }],
      [{ sessionId: "B", weight: 1 }],
    ]);
  });

  it("is a no-op when sessionId and targetId are the same session", () => {
    // Regression: without this guard, the same-entry overwrite-then-filter
    // sequence drops the session from its column and re-adds it as a new
    // column, silently relocating it instead of no-op'ing.
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 1 },
        { sessionId: "B", weight: 1 },
      ],
    ];
    expect(mergeInColumn(layout, "A", "A")).toBe(layout);
  });

  it("compounds weight across repeated merges into the same slot", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 1 },
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ];
    const afterFirst = mergeInColumn(layout, "A", "B");
    expect(afterFirst).toEqual([
      [
        { sessionId: "A", weight: 2 },
        { sessionId: "C", weight: 1 },
      ],
      [{ sessionId: "B", weight: 1 }],
    ]);

    const afterSecond = mergeInColumn(afterFirst, "C", "A");
    expect(afterSecond).toEqual([
      [{ sessionId: "C", weight: 3 }],
      [{ sessionId: "B", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
    ]);
  });
});

describe("joinOtherColumn", () => {
  it("is a no-op when sessionId and targetId already share a column", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 1 },
        { sessionId: "B", weight: 1 },
      ],
    ];
    expect(joinOtherColumn(layout, "A", "B")).toBe(layout);
  });

  it("moves a session to weight 1 in a different column", () => {
    const layout: ColumnLayout = [
      [{ sessionId: "A", weight: 3 }],
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
      ],
    ];
    expect(joinOtherColumn(layout, "A", "B")).toEqual([
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
        { sessionId: "A", weight: 1 },
      ],
    ]);
  });
});

describe("splitToNewColumn", () => {
  it("resets weight to 1 regardless of the session's prior weight", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 5 },
        { sessionId: "B", weight: 1 },
      ],
    ];
    expect(splitToNewColumn(layout, "A", 1)).toEqual([
      [{ sessionId: "B", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
    ]);
  });

  it("accounts for index shift when the source column precedes gutterIndex", () => {
    const layout: ColumnLayout = [
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
      [{ sessionId: "C", weight: 1 }],
    ];
    expect(splitToNewColumn(layout, "A", 2)).toEqual([
      [{ sessionId: "B", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "C", weight: 1 }],
    ]);
  });
});

describe("swapInLayout", () => {
  it("exchanges sessionIds at two slots without changing weights", () => {
    const layout: ColumnLayout = [
      [
        { sessionId: "A", weight: 2 },
        { sessionId: "B", weight: 3 },
      ],
      [{ sessionId: "C", weight: 1 }],
    ];
    expect(swapInLayout(layout, "A", "C")).toEqual([
      [
        { sessionId: "C", weight: 2 },
        { sessionId: "B", weight: 3 },
      ],
      [{ sessionId: "A", weight: 1 }],
    ]);
  });
});
