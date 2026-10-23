import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { extractMermaidBlocks, lintDiagrams } from "../diagrams";

let root = "";

function write(rel: string, text: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const page = (type: string, body: string) =>
  `---\ntype: ${type}\ndescription: d\ncreated: 2026-10-01\nupdated: 2026-10-10\n---\n${body}`;

const W = "projects/pavilio/wiki";
const GOOD = ["```mermaid", "flowchart TD", '  A["x | y"] --> B', "```"];
// An em dash in a bare subgraph title is a lexical error.
const BAD = ["```mermaid", "flowchart TD", "  subgraph Foo — bar", "    A --> B", "  end", "```"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-diagrams-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("extractMermaidBlocks", () => {
  it("takes mermaid fences only, with their opening line", () => {
    const body = ["# T", "```ts", "x", "```", "~~~ MERMAID ", "pie", "~~~", "````mermaid", "graph", "```", "````"].join("\n");
    expect(extractMermaidBlocks(body)).toEqual([
      { code: "pie", line: 4 },
      { code: "graph\n```", line: 7 },
    ]);
  });
});

describe("lintDiagrams", () => {
  it("reports the block mermaid cannot parse, at its fence line", async () => {
    // Body starts on file line 7 (6 frontmatter lines above it).
    write(`${W}/concepts/flow.md`, page("concept", ["Intro.", ...GOOD, "", ...BAD, ""].join("\n")));
    write(`${W}/overview.md`, page("overview", [...GOOD, ""].join("\n")));
    const report = await lintDiagrams(root, "pavilio");
    expect(report.diagramCheck).toBeUndefined();
    expect(report.diagrams).toHaveLength(1);
    expect(report.diagrams[0]).toMatchObject({ page: "wiki/concepts/flow.md", line: 13 });
    expect(report.diagrams[0].error).not.toBe("");
  });

  it("is empty for a wiki without diagrams", async () => {
    write(`${W}/concepts/plain.md`, page("concept", "No diagrams here.\n```ts\nconst x = 1;\n```\n"));
    expect(await lintDiagrams(root, "pavilio")).toEqual({ diagrams: [] });
  });
});
