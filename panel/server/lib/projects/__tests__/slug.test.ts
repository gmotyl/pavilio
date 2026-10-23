import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { scaffoldProject } from "../scaffold";
import { isValidProjectSlug, slugifyProjectTitle } from "../slug";

describe("slugifyProjectTitle", () => {
  it("slugifies titles: spaces, diacritics, punctuation runs, trimming", () => {
    expect(slugifyProjectTitle("Edge TTS voices")).toBe("edge-tts-voices");
    expect(slugifyProjectTitle("Zażółć gęślą")).toBe("zazolc-gesla");
    expect(slugifyProjectTitle("  RAG / KG  ")).toBe("rag-kg");
    for (const title of ["Edge TTS voices", "Zażółć gęślą", "  RAG / KG  "]) {
      expect(isValidProjectSlug(slugifyProjectTitle(title)), title).toBe(true);
    }
  });

  it("empty result for punctuation-only titles", () => {
    expect(slugifyProjectTitle("!!!")).toBe("");
    expect(slugifyProjectTitle("  -- / --  ")).toBe("");
    expect(isValidProjectSlug("")).toBe(false);
  });
});

describe("isValidProjectSlug", () => {
  it("rejects archived and non-slug names", () => {
    expect(isValidProjectSlug("archived")).toBe(false);
    // A literal `/api/projects/<segment>` route would shadow `GET /:name` for this project.
    expect(isValidProjectSlug("default-terminal-users")).toBe(false);
    for (const bad of ["", "Acme", "-acme", ".acme", "_acme", "a b", "a/b", "../x", "zażółć"]) {
      expect(isValidProjectSlug(bad), bad).toBe(false);
    }
    for (const good of ["acme", "tts-voices", "v2.0", "a_b", "0x"]) {
      expect(isValidProjectSlug(good), good).toBe(true);
    }
  });

  describe("scaffold", () => {
    let root = "";
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "slug-"));
      mkdirSync(join(root, "projects"), { recursive: true });
      writeFileSync(join(root, ".projects.local.md"), "| Project | Type | Path |\n| ------- | ---- | ---- |\n");
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it("scaffold name check agrees with isValidProjectSlug", () => {
      const projectsDir = join(root, "projects");
      for (const name of ["archived", "", "Acme", "-acme", "a b", "a/b", "acme", "tts-voices", "v2.0"]) {
        const run = () => scaffoldProject({ projectsDir, name, kind: "project", today: "2026-10-23" });
        if (isValidProjectSlug(name)) expect(run, name).not.toThrow();
        else expect(run, name).toThrow(/invalid project name/);
      }
    });
  });
});
