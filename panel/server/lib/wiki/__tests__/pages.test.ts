import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { walkWikiPages, parsePage } from "../pages";

let wikiDir = "";

function write(rel: string, text: string) {
  const abs = join(wikiDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  wikiDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
});

afterEach(() => {
  rmSync(wikiDir, { recursive: true, force: true });
});

describe("walkWikiPages", () => {
  it("walks wiki pages and skips raw/ and log.md", () => {
    write("index.md", "---\ntype: index\n---\n# Index\n");
    write("log.md", "- ingested: notes/a.md #abcdef012345\n");
    write("raw/article-x.md", "# raw article\n");
    write("raw/nested/deep.md", "# deep raw\n");
    write("concepts/speech.md", "---\ntype: concept\n---\nSpeech.\n");
    write("entities/greg.md", "---\ntype: entity\nkind: person\n---\nGreg.\n");
    write("sources/notes/2026-10-19-a.md", "---\ntype: source\n---\nA.\n");
    write("concepts/not-markdown.txt", "ignored\n");

    const pages = walkWikiPages(wikiDir);

    expect(pages.map((p) => p.path)).toEqual([
      "concepts/speech.md",
      "entities/greg.md",
      "index.md",
      "sources/notes/2026-10-19-a.md",
    ]);
    const speech = pages.find((p) => p.path === "concepts/speech.md")!;
    expect(speech.frontmatter.type).toBe("concept");
    expect(speech.body).toBe("Speech.\n");
  });

  it("returns an empty list for a missing wiki dir", () => {
    expect(walkWikiPages(join(wikiDir, "nope"))).toEqual([]);
  });
});

describe("parsePage", () => {
  it("parses frontmatter fields with their types", () => {
    const text = [
      "---",
      "type: source",
      "description: The one line the index shows",
      "entities: [greg, pavilio]",
      "concepts:",
      "  - speech",
      "  - auto-sync",
      "record: progress/2026-10-19-a.md",
      "raw: raw/article-x.md",
      "created: 2026-10-19",
      "updated: 2026-10-20",
      "kind: person",
      "title: Greg Motyl",
      "aliases: [Greg, gmotyl]",
      "sources: [sources/notes/a.md]",
      "---",
      "# Body",
      "",
    ].join("\n");

    const { frontmatter, body } = parsePage(text);

    expect(frontmatter).toEqual({
      type: "source",
      description: "The one line the index shows",
      entities: ["greg", "pavilio"],
      concepts: ["speech", "auto-sync"],
      record: "progress/2026-10-19-a.md",
      raw: "raw/article-x.md",
      created: "2026-10-19",
      updated: "2026-10-20",
      kind: "person",
      title: "Greg Motyl",
      aliases: ["Greg", "gmotyl"],
      sources: ["sources/notes/a.md"],
    });
    expect(body).toBe("# Body\n");
  });

  it("drops fields with the wrong type", () => {
    const { frontmatter } = parsePage(
      "---\ntype: 3\nentities: greg\nkind: alien\nconcepts: [ok, 7]\n---\nx\n",
    );
    expect(frontmatter).toEqual({ concepts: ["ok"] });
  });

  it("yields empty frontmatter for malformed yaml", () => {
    expect(parsePage("---\ntype: [unclosed\n---\nBody\n")).toEqual({
      frontmatter: {},
      body: "Body\n",
    });
    expect(parsePage("---\n- just\n- a list\n---\nBody\n").frontmatter).toEqual({});
    expect(parsePage("No frontmatter here\n")).toEqual({
      frontmatter: {},
      body: "No frontmatter here\n",
    });
    expect(parsePage("---\ntype: unterminated\nno closing fence\n")).toEqual({
      frontmatter: {},
      body: "---\ntype: unterminated\nno closing fence\n",
    });
  });
});
