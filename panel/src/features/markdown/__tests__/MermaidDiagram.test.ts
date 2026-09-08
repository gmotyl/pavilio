import { describe, it, expect } from "vitest";
import { fixAmbiguousLabels, subgraphTitlesInOrder } from "../MermaidDiagram";

describe("fixAmbiguousLabels", () => {
  it("quotes labels starting with /", () => {
    expect(fixAmbiguousLabels("A[/api/users]")).toBe('A["/api/users"]');
  });

  it("quotes labels starting with \\", () => {
    expect(fixAmbiguousLabels("A[\\path\\to]")).toBe('A["\\path\\to"]');
  });

  it("leaves normal labels untouched", () => {
    expect(fixAmbiguousLabels("A[normal label]")).toBe("A[normal label]");
  });

  it("handles multiple labels in one string", () => {
    const input = "A[/first] --> B[/second]";
    const result = fixAmbiguousLabels(input);
    expect(result).toContain('A["/first"]');
    expect(result).toContain('B["/second"]');
  });

  it("handles string with no labels", () => {
    expect(fixAmbiguousLabels("A --> B")).toBe("A --> B");
  });
});

describe("subgraphTitlesInOrder", () => {
  it("reads bare multi-word titles in declaration order", () => {
    const chart = [
      "flowchart TD",
      "  A --> B1",
      "  subgraph Current broken path",
      "    B1[x] --> B2[y]",
      "  end",
      "  subgraph Fixed path",
      "    C1[p] --> C2[q]",
      "  end",
    ].join("\n");
    expect(subgraphTitlesInOrder(chart)).toEqual(["Current broken path", "Fixed path"]);
  });

  it("unwraps explicit ids with quoted labels", () => {
    const chart = 'flowchart TD\n  subgraph Broken["Current broken path"]\n  end\n  subgraph Fixed["Fixed path"]\n  end';
    expect(subgraphTitlesInOrder(chart)).toEqual(["Current broken path", "Fixed path"]);
  });

  it("unwraps explicit ids with unquoted labels and a separating space", () => {
    const chart = "flowchart TD\n  subgraph Broken [Old way]\n  end";
    expect(subgraphTitlesInOrder(chart)).toEqual(["Old way"]);
  });

  it("keeps single-word titles as written", () => {
    const chart = "flowchart TD\n  subgraph Before\n  end\n  subgraph Migration\n  end\n  subgraph After\n  end";
    expect(subgraphTitlesInOrder(chart)).toEqual(["Before", "Migration", "After"]);
  });

  it("returns nothing for a flowchart without subgraphs", () => {
    expect(subgraphTitlesInOrder("flowchart TD\n  A --> B")).toEqual([]);
  });

  it("ignores nodes whose label merely contains the word subgraph", () => {
    expect(subgraphTitlesInOrder("flowchart TD\n  A[render subgraph later] --> B")).toEqual([]);
  });
});
