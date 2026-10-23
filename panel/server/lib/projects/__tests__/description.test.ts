import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { projectDescription } from "../description";

let projectDir = "";

function write(rel: string, text: string) {
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "project-description-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("projectDescription", () => {
  it("description prefers topic frontmatter", () => {
    write(
      "PROJECT.md",
      "---\nkind: research\ntopic: edge tts voices\n---\n# Voices\n\n## Project Overview\n\nSomething else. More.\n",
    );
    write("wiki/overview.md", "Wiki overview.\n");
    expect(projectDescription(projectDir)).toBe("edge tts voices");
  });

  it("description falls back to first sentence under Overview heading", () => {
    write(
      "PROJECT.md",
      "# Alpha\n\n## Context\n\nNot this one.\n\n## Project Overview\n\nAlpha builds the\npanel. It also ships skills.\n\nSecond paragraph.\n",
    );
    expect(projectDescription(projectDir)).toBe("Alpha builds the panel.");
  });

  it("description falls back to wiki overview first paragraph", () => {
    write("PROJECT.md", "# Beta\n\n## Notes\n\nNo overview here.\n");
    write(
      "wiki/overview.md",
      "---\ntitle: Overview\n---\n# Overview\n\nThe wiki covers voices. And more.\n\nLater paragraph.\n",
    );
    expect(projectDescription(projectDir)).toBe("The wiki covers voices. And more.");
  });

  it("description is null when no source exists", () => {
    expect(projectDescription(projectDir)).toBeNull();
    write("PROJECT.md", "# Gamma\n\n## Notes\n\nNothing useful.\n");
    expect(projectDescription(projectDir)).toBeNull();
  });

  it("description stops at the end of an empty Overview section", () => {
    write("PROJECT.md", "# Delta\n\n## Overview\n\n## Next\n\nFoo.\n");
    expect(projectDescription(projectDir)).toBeNull();
    write("wiki/overview.md", "The wiki paragraph.\n");
    expect(projectDescription(projectDir)).toBe("The wiki paragraph.");
  });

  it("long descriptions are cut with an ellipsis", () => {
    const topic = "word ".repeat(60).trim();
    write("PROJECT.md", `---\ntopic: ${topic}\n---\n# Long\n`);
    const desc = projectDescription(projectDir);
    expect(desc).not.toBeNull();
    expect(desc!.length).toBeLessThanOrEqual(140);
    expect(desc!.endsWith("…")).toBe(true);
    expect(topic.startsWith(desc!.slice(0, -1))).toBe(true);
  });
});
