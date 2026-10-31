import { describe, it, expect } from "vitest";
import { fixAmbiguousLabels, subgraphTitlesInOrder, clusterPaletteOrder, mermaidThemeVariables } from "../MermaidDiagram";

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

// WCAG 2.x relative luminance of a #rrggbb colour.
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("mermaid theme variables", () => {
  it("sets dark, distinct ER attribute row colours with readable contrast", () => {
    const vars = mermaidThemeVariables as Record<string, string | undefined>;
    const { attributeBackgroundColorOdd: odd, attributeBackgroundColorEven: even, textColor } = vars;
    // mermaid 11's erBox shape fills attribute rows from rowOdd/rowEven; the
    // attributeBackgroundColor* names are only defaulted, never rendered.
    expect(vars.rowOdd).toBe(odd);
    expect(vars.rowEven).toBe(even);
    expect(odd).toMatch(/^#[0-9a-f]{6}$/i);
    expect(even).toMatch(/^#[0-9a-f]{6}$/i);
    expect(odd!.toLowerCase()).not.toBe(even!.toLowerCase());
    expect(textColor).toBe("#e4e4e7");
    expect(contrastRatio(odd!, textColor!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(even!, textColor!)).toBeGreaterThanOrEqual(4.5);
  });
});
