import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { resolveWikiLink, buildBacklinks } from "../links";
import { extractWikiLinks, parseWikiLink } from "../wikilinks";

let root = "";

function write(rel: string, text: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function resolve(raw: string) {
  const link = parseWikiLink(raw);
  if (!link) throw new Error(`unparsable: ${raw}`);
  return resolveWikiLink(link, { workspaceRoot: root, project: "pavilio" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-links-"));
  write("projects/pavilio/wiki/concepts/x.md", "# X\n");
  write("projects/pavilio/progress/2026-10-19-a.md", "# A\n");
  write("projects/pavilio/plans/openspec/specs/speech/spec.md", "# Speech\n");
  write("projects/metro/wiki/entities/y.md", "# Y\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveWikiLink", () => {
  it("resolves project-root paths without .md", () => {
    const concept = resolve("wiki/concepts/x");
    expect(concept).toMatchObject({
      project: "pavilio",
      target: "wiki/concepts/x",
      absPath: join(root, "projects/pavilio/wiki/concepts/x.md"),
      exists: true,
    });
    expect(resolve("progress/2026-10-19-a").absPath).toBe(join(root, "projects/pavilio/progress/2026-10-19-a.md"));
    expect(resolve("progress/2026-10-19-a").exists).toBe(true);
    const spec = resolve("plans/openspec/specs/speech/spec");
    expect(spec.absPath).toBe(join(root, "projects/pavilio/plans/openspec/specs/speech/spec.md"));
    expect(spec.exists).toBe(true);
  });

  it("resolves a project-prefixed link", () => {
    expect(resolve("metro:wiki/entities/y|Y")).toMatchObject({
      project: "metro",
      target: "wiki/entities/y",
      absPath: join(root, "projects/metro/wiki/entities/y.md"),
      exists: true,
    });
  });

  it("keeps the label after a pipe", () => {
    expect(resolve("metro:wiki/entities/y|Y").label).toBe("Y");
    expect(resolve("wiki/concepts/x|The X concept").label).toBe("The X concept");
    // Without a pipe the label is the link text as written.
    expect(resolve("wiki/concepts/x").label).toBe("wiki/concepts/x");
  });

  it("marks missing targets as not existing", () => {
    const missing = resolve("wiki/concepts/nope");
    expect(missing.absPath).toBe(join(root, "projects/pavilio/wiki/concepts/nope.md"));
    expect(missing.exists).toBe(false);
    expect(resolve("ghost:wiki/concepts/x").exists).toBe(false);
    // A path escaping the project is not a link at all.
    expect(parseWikiLink("../metro/wiki/entities/y")).toBeNull();
  });
});

describe("extractWikiLinks", () => {
  it("ignores links inside code", () => {
    const md = [
      "See [[wiki/concepts/x]] and `[[wiki/concepts/inline]]`.",
      "Double ``code with [[wiki/concepts/double]] inside`` here.",
      "```md",
      "[[wiki/concepts/fenced]]",
      "```",
      "~~~",
      "[[wiki/concepts/tilde]]",
      "~~~",
      "Then [[metro:wiki/entities/y|Y]].",
    ].join("\n");
    expect(extractWikiLinks(md).map((l) => l.raw)).toEqual(["wiki/concepts/x", "metro:wiki/entities/y|Y"]);
  });
});

describe("buildBacklinks", () => {
  it("builds a backlink map", () => {
    write("projects/pavilio/wiki/index.md", "[[wiki/concepts/x]] [[wiki/entities/greg|Greg]]\n");
    write(
      "projects/pavilio/wiki/entities/greg.md",
      "Works on [[wiki/concepts/x]] twice [[wiki/concepts/x]], self [[wiki/entities/greg]], see [[progress/2026-10-19-a]] and [[metro:wiki/entities/y]].\n`[[wiki/concepts/ignored]]`\n",
    );
    write("projects/pavilio/wiki/log.md", "[[wiki/concepts/x]]\n");

    expect(buildBacklinks(root, "pavilio")).toEqual({
      "wiki/concepts/x": ["wiki/entities/greg", "wiki/index"],
      "wiki/entities/greg": ["wiki/index"],
      "wiki/index": [],
      "progress/2026-10-19-a": ["wiki/entities/greg"],
      "metro:wiki/entities/y": ["wiki/entities/greg"],
    });
  });
});
