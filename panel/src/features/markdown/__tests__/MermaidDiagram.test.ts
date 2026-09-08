import { describe, it, expect } from "vitest";
import { fixAmbiguousLabels, subgraphTitlesInOrder, clusterPaletteOrder } from "../MermaidDiagram";

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

describe("subgraphTitlesInOrder — mermaid comments", () => {
  it("ignores a commented-out subgraph declaration", () => {
    const chart = "flowchart TD\n%% subgraph Ghost\n  subgraph Real one\n  end";
    expect(subgraphTitlesInOrder(chart)).toEqual(["Real one"]);
  });

  it("keeps a trailing %% verbatim, because mermaid renders it in the label", () => {
    // mermaid does not strip `%%` from a subgraph title — the cluster label is
    // literally "Foo %% legacy name", so the parsed title has to match it.
    const chart = "flowchart TD\n  subgraph Foo %% legacy name\n  end";
    expect(subgraphTitlesInOrder(chart)).toEqual(["Foo %% legacy name"]);
  });
});

describe("clusterPaletteOrder", () => {
  const beforeAfter = [
    "flowchart TD",
    "  A --> C1",
    "  A --> C2",
    "  subgraph Current broken path",
    "    C1[Problem step] --> D1[Failure]",
    "  end",
    "  subgraph Fixed path",
    "    C2[Corrected step] --> D2[Success]",
    "  end",
  ].join("\n");

  it("gives the first declared subgraph palette 0 when the DOM lists it second", () => {
    // dagre hands back "Fixed path" first — the reason the bug was visible.
    expect(clusterPaletteOrder(["Fixed path", "Current broken path"], beforeAfter)).toEqual([1, 0]);
  });

  it("is an identity mapping when the DOM already matches declaration order", () => {
    expect(clusterPaletteOrder(["Current broken path", "Fixed path"], beforeAfter)).toEqual([0, 1]);
  });

  it("restores declaration order for a three-way comparison", () => {
    const chart = "flowchart TD\n  subgraph Before\n  end\n  subgraph Migration\n  end\n  subgraph After\n  end";
    expect(clusterPaletteOrder(["After", "Migration", "Before"], chart)).toEqual([2, 1, 0]);
  });

  it("never hands the same palette slot to two clusters", () => {
    const chart = "flowchart TD\n  subgraph Retry\n  end\n  subgraph Retry\n  end\n  subgraph Done\n  end";
    const slots = clusterPaletteOrder(["Retry", "Done", "Retry"], chart);
    expect([...slots].sort()).toEqual([0, 1, 2]);
    expect(slots[1]).toBe(2); // "Done" is declared last, so it takes the last slot
  });

  it("sorts a label the source does not account for last, without dropping it", () => {
    expect(clusterPaletteOrder(["Mystery", "Fixed path", "Current broken path"], beforeAfter)).toEqual([2, 1, 0]);
  });

  it("returns nothing when the diagram has no clusters", () => {
    expect(clusterPaletteOrder([], "flowchart TD\n  A --> B")).toEqual([]);
  });
});
