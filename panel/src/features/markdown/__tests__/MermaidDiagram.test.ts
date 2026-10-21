import { describe, it, expect } from "vitest";
import { fixAmbiguousLabels, subgraphTitlesInOrder, clusterPaletteOrder } from "../MermaidDiagram";

describe("fixAmbiguousLabels", () => {
  it.each([
    ["quotes labels starting with /", "A[/api/users]", 'A["/api/users"]'],
    ["quotes labels starting with \\", "A[\\path\\to]", 'A["\\path\\to"]'],
    ["leaves normal labels untouched", "A[normal label]", "A[normal label]"],
    ["handles multiple labels in one string", "A[/first] --> B[/second]", 'A["/first"] --> B["/second"]'],
    ["handles string with no labels", "A --> B", "A --> B"],
  ])("%s", (_label, input, expected) => {
    expect(fixAmbiguousLabels(input)).toBe(expected);
  });
});

describe("subgraphTitlesInOrder", () => {
  it.each<[label: string, chart: string, titles: string[]]>([
    [
      "reads bare multi-word titles in declaration order",
      [
        "flowchart TD",
        "  A --> B1",
        "  subgraph Current broken path",
        "    B1[x] --> B2[y]",
        "  end",
        "  subgraph Fixed path",
        "    C1[p] --> C2[q]",
        "  end",
      ].join("\n"),
      ["Current broken path", "Fixed path"],
    ],
    [
      "unwraps explicit ids with quoted labels",
      'flowchart TD\n  subgraph Broken["Current broken path"]\n  end\n  subgraph Fixed["Fixed path"]\n  end',
      ["Current broken path", "Fixed path"],
    ],
    ["unwraps explicit ids with unquoted labels and a separating space", "flowchart TD\n  subgraph Broken [Old way]\n  end", ["Old way"]],
    [
      "keeps single-word titles as written",
      "flowchart TD\n  subgraph Before\n  end\n  subgraph Migration\n  end\n  subgraph After\n  end",
      ["Before", "Migration", "After"],
    ],
    ["returns nothing for a flowchart without subgraphs", "flowchart TD\n  A --> B", []],
    ["ignores nodes whose label merely contains the word subgraph", "flowchart TD\n  A[render subgraph later] --> B", []],
    ["ignores a commented-out subgraph declaration", "flowchart TD\n%% subgraph Ghost\n  subgraph Real one\n  end", ["Real one"]],
    // mermaid does not strip `%%` from a subgraph title — the cluster label is
    // literally "Foo %% legacy name", so the parsed title has to match it.
    ["keeps a trailing %% verbatim, because mermaid renders it in the label", "flowchart TD\n  subgraph Foo %% legacy name\n  end", ["Foo %% legacy name"]],
  ])("%s", (_label, chart, titles) => {
    expect(subgraphTitlesInOrder(chart)).toEqual(titles);
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
