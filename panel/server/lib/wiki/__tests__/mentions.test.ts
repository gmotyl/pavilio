import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { countMentions } from "../mentions";

let projectDir = "";

function write(rel: string, text: string) {
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** A wiki page referencing the given slugs in its frontmatter. */
function page(type: string, refs: { entities?: string[]; concepts?: string[] }) {
  const lines = [`type: ${type}`, "description: d"];
  if (refs.entities) lines.push(`entities: [${refs.entities.join(", ")}]`);
  if (refs.concepts) lines.push(`concepts: [${refs.concepts.join(", ")}]`);
  return `---\n${lines.join("\n")}\n---\nbody\n`;
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wiki-mentions-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("countMentions", () => {
  it("counts sources and repo pages only", () => {
    write("wiki/sources/2026-10-01-a.md", page("source", { concepts: ["speech"], entities: ["greg"] }));
    write("wiki/repos/pavilio/ARCHITECTURE.md", page("repo", { concepts: ["speech"] }));
    write("wiki/concepts/speech.md", page("concept", { concepts: ["speech"] }));
    write("wiki/entities/greg.md", page("entity", { entities: ["greg"] }));
    write("wiki/overview.md", page("overview", { concepts: ["speech"] }));
    write("wiki/repos/index.md", page("repo-index", { concepts: ["speech"] }));
    write("wiki/raw/x.md", page("source", { concepts: ["speech"] }));

    expect(countMentions(projectDir).slugs).toEqual({
      "concepts/speech": ["repos/pavilio/ARCHITECTURE.md", "sources/2026-10-01-a.md"],
      "entities/greg": ["sources/2026-10-01-a.md"],
    });
  });

  it("qualifies at two sources", () => {
    write("wiki/sources/a.md", page("source", { concepts: ["speech", "lonely"], entities: ["greg"] }));
    write("wiki/sources/b.md", page("source", { concepts: ["speech", "speech"] }));
    write("wiki/repos/pavilio/index.md", page("repo", { entities: ["greg"] }));

    const result = countMentions(projectDir);
    expect(result.slugs["concepts/speech"]).toEqual(["sources/a.md", "sources/b.md"]);
    expect(result.qualifying).toEqual(["concepts/speech", "entities/greg"]);
  });

  it("notes and questions never count", () => {
    write("wiki/sources/a.md", page("source", { concepts: ["speech"] }));
    write("wiki/notes/n.md", page("note", { concepts: ["speech"] }));
    write("wiki/questions/2026-10-02-q.md", page("question", { concepts: ["speech", "other"] }));

    const result = countMentions(projectDir);
    expect(result.slugs).toEqual({ "concepts/speech": ["sources/a.md"] });
    expect(result.qualifying).toEqual([]);
  });

  it("glossary terms qualify with one source", () => {
    write(
      "CONTEXT.md",
      "# Glossary\n\n- **Speech** — spoken answers. See [[wiki/concepts/speech]]\n"
        + "- **Cell** — a terminal. See [[wiki/concepts/cell|Cell]]\n",
    );
    write("wiki/sources/a.md", page("source", { concepts: ["speech", "plain"] }));

    const result = countMentions(projectDir);
    // `cell` has no source at all, so there is nothing to write its page from.
    expect(result.qualifying).toEqual(["concepts/speech"]);
  });

  it("touched narrows qualifying", () => {
    write("wiki/sources/a.md", page("source", { concepts: ["speech", "cells"], entities: ["greg"] }));
    write("wiki/sources/b.md", page("source", { concepts: ["speech", "cells"], entities: ["greg"] }));

    const result = countMentions(projectDir, { touched: ["concepts/speech", "entities/greg", "concepts/nope"] });
    expect(result.qualifying).toEqual(["concepts/speech", "entities/greg"]);
    expect(Object.keys(result.slugs)).toEqual(["concepts/cells", "concepts/speech", "entities/greg"]);
  });
});
