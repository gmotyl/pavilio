import { describe, it, expect } from "vitest";
import { buildConflictPrompt } from "../buildConflictPrompt.js";

const base = {
  repoRoot: "/Users/gmotyl/git/prv/projects",
  branch: "main",
  dataPaths: ["projects/"],
  generatedPaths: ["panel/", ".opencode/", "opencode.json"],
};

describe("buildConflictPrompt", () => {
  it("classifies generated paths by prefix and exact match", () => {
    const out = buildConflictPrompt({
      ...base,
      conflictFiles: ["panel/src/features/git/GitPanel.tsx", "opencode.json"],
    });
    expect(out).toContain("Generated files");
    expect(out).toContain("panel/src/features/git/GitPanel.tsx");
    expect(out).toContain("opencode.json");
    expect(out).toContain("WHOLESALE");
    expect(out).not.toContain("Data files");
    expect(out).not.toContain("Unclassified");
  });

  it("classifies data paths and tells the resolver to keep both sides", () => {
    const out = buildConflictPrompt({
      ...base,
      conflictFiles: ["projects/metro/notes/2026-07-01_standup.md"],
    });
    expect(out).toContain("Data files");
    expect(out).toContain("Keep BOTH sides");
    expect(out).not.toContain("Generated files");
  });

  it("flags files matching neither list", () => {
    const out = buildConflictPrompt({ ...base, conflictFiles: ["README.md"] });
    expect(out).toContain("Unclassified");
    expect(out).toContain("README.md");
    expect(out).toContain("panel.config.ts");
  });

  it("includes the repo root and branch in the steps", () => {
    const out = buildConflictPrompt({ ...base, conflictFiles: ["panel/x.ts"] });
    expect(out).toContain("/Users/gmotyl/git/prv/projects");
    expect(out).toContain("branch main");
  });

  it("warns to check HEAD holds a full tree before restoring wholesale", () => {
    const out = buildConflictPrompt({ ...base, conflictFiles: ["panel/x.ts"] });
    expect(out).toContain("ls-tree");
    expect(out).toContain("DELETES");
  });

  it("returns an empty string when there is nothing to resolve", () => {
    expect(buildConflictPrompt({ ...base, conflictFiles: [] })).toBe("");
  });

  it("does not treat a lookalike prefix as a match", () => {
    const out = buildConflictPrompt({ ...base, conflictFiles: ["panelette/x.ts"] });
    expect(out).toContain("Unclassified");
    expect(out).not.toContain("Generated files");
  });

  it("splits a mixed conflict into all three sections", () => {
    const out = buildConflictPrompt({
      ...base,
      conflictFiles: ["panel/a.ts", "projects/p/note.md", "README.md"],
    });
    expect(out).toContain("Generated files (rsynced by scripts/update.sh) — 1");
    expect(out).toContain("Data files (project notes, plans, memos) — 1");
    expect(out).toContain("Unclassified — 1");
  });
});
