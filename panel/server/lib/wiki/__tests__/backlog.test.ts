import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { pageBacklog } from "../backlog";

let projectDir = "";

function write(rel: string, text: string) {
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** A source page naming the given slugs in its frontmatter. */
function source(refs: { entities?: string[]; concepts?: string[] }) {
  const lines = ["type: source", "description: d"];
  if (refs.entities) lines.push(`entities: [${refs.entities.join(", ")}]`);
  if (refs.concepts) lines.push(`concepts: [${refs.concepts.join(", ")}]`);
  return `---\n${lines.join("\n")}\n---\nbody\n`;
}

/** A knowledge page citing the given `sources:` entries verbatim. */
function knowledge(type: string, sources: string[]) {
  const list = sources.map((s) => `  - ${JSON.stringify(s)}`).join("\n");
  return `---\ntype: ${type}\ndescription: d\nsources:\n${list}\n---\nbody\n`;
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wiki-backlog-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("pageBacklog", () => {
  it("lists every source of a qualifying slug with no page under create", () => {
    write("wiki/sources/a.md", source({ concepts: ["speech"] }));
    write("wiki/sources/b.md", source({ concepts: ["speech"] }));

    expect(pageBacklog(projectDir).create).toEqual({
      "concepts/speech": ["wiki/sources/a.md", "wiki/sources/b.md"],
    });
  });

  it("lists only the sources an existing page does not cite under update", () => {
    write("wiki/sources/a.md", source({ concepts: ["speech"] }));
    write("wiki/sources/b.md", source({ concepts: ["speech"] }));
    write("wiki/sources/c.md", source({ concepts: ["speech"] }));
    write("wiki/concepts/speech.md", knowledge("concept", ["wiki/sources/a.md", "[[wiki/sources/b]]"]));

    const result = pageBacklog(projectDir);
    expect(result.update).toEqual({ "concepts/speech": ["wiki/sources/c.md"] });
    expect(result.create).toEqual({});
  });

  it("accepts wiki-relative and extensionless sources entries", () => {
    write("wiki/sources/a.md", source({ entities: ["greg"] }));
    write("wiki/sources/b.md", source({ entities: ["greg"] }));
    write("wiki/entities/greg.md", knowledge("entity", ["sources/a", "wiki/sources/b"]));

    expect(pageBacklog(projectDir).update).toEqual({});
  });

  it("leaves a fully cited page out of update", () => {
    write("wiki/sources/a.md", source({ concepts: ["speech"] }));
    write("wiki/concepts/speech.md", knowledge("concept", ["wiki/sources/a.md"]));

    expect(pageBacklog(projectDir)).toEqual({ create: {}, update: {}, waiting: [] });
  });

  it("reports a slug below the threshold with no page as waiting", () => {
    write("wiki/sources/a.md", source({ concepts: ["lonely", "speech"] }));
    write("wiki/sources/b.md", source({ concepts: ["speech"] }));

    const result = pageBacklog(projectDir);
    expect(result.waiting).toEqual(["concepts/lonely"]);
    expect(Object.keys(result.create)).toEqual(["concepts/speech"]);
  });

  it("creates a glossary term's page from one source", () => {
    write("CONTEXT.md", "- **Relay** — a relay. See [[wiki/concepts/relay]].\n");
    write("wiki/sources/a.md", source({ concepts: ["relay"] }));

    expect(pageBacklog(projectDir).create).toEqual({ "concepts/relay": ["wiki/sources/a.md"] });
  });

  it("narrows every group to the touched slugs", () => {
    write("wiki/sources/a.md", source({ concepts: ["speech", "relay", "lonely"], entities: ["greg"] }));
    write("wiki/sources/b.md", source({ concepts: ["speech", "relay"], entities: ["greg"] }));
    write("wiki/entities/greg.md", knowledge("entity", ["wiki/sources/a.md"]));

    const result = pageBacklog(projectDir, { touched: ["concepts/speech", "entities/greg"] });
    expect(result).toEqual({
      create: { "concepts/speech": ["wiki/sources/a.md", "wiki/sources/b.md"] },
      update: { "entities/greg": ["wiki/sources/b.md"] },
      waiting: [],
    });
  });
});
