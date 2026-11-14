import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// From panel/server/lib/__tests__ up 4 levels reaches the repo root, then skills/.
const REPO_ROOT = join(__dirname, "../../../../");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const SETUP_OPENCODE = join(REPO_ROOT, "scripts/setup:opencode");

describe("pavilio skills — OpenCode wrappers", () => {
  it("generated OpenCode wrappers point to every authoritative Pavilio skill", () => {
    // Authoritative skills are the skills/pavilio-* directories that contain a SKILL.md.
    const authoritative = readdirSync(SKILLS_DIR)
      .filter((name) => name.startsWith("pavilio-"))
      .filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory())
      .filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")));

    // The two new skills must be part of the authoritative set.
    expect(authoritative).toContain("pavilio-openspec-storage");
    expect(authoritative).toContain("pavilio-openspec-migrate");

    // `.opencode/` is generated and gitignored, so asserting against the working
    // copy only tests whether *this machine* has run setup. The repo-level
    // invariant is about the generator: drive it into a throwaway directory and
    // assert on what it emits, so the test holds in a fresh clone too.
    const outRoot = mkdtempSync(join(tmpdir(), "pavilio-opencode-"));
    try {
      execFileSync("bash", [SETUP_OPENCODE], {
        env: { ...process.env, PAVILIO_OPENCODE_OUT: outRoot },
        stdio: "pipe",
      });

      const generatedDir = join(outRoot, ".opencode/commands");
      const missing = authoritative.filter(
        (name) => !existsSync(join(generatedDir, `${name}.md`)),
      );
      expect(
        missing,
        `setup:opencode generated no wrapper for: ${missing.join(", ")}`,
      ).toEqual([]);

      // Wrappers are only reachable once they are registered in opencode.json —
      // that registration is the other half of the same generation step.
      const config = JSON.parse(
        readFileSync(join(outRoot, "opencode.json"), "utf8"),
      ) as { command?: Record<string, { template?: string }> };
      const unregistered = authoritative.filter((name) => !config.command?.[name]);
      expect(
        unregistered,
        `setup:opencode left commands unregistered in opencode.json: ${unregistered.join(", ")}`,
      ).toEqual([]);

      // The wrapper must point back at the authoritative SKILL.md, not a copy.
      for (const name of authoritative) {
        expect(config.command?.[name]?.template).toContain(`skills/${name}/SKILL.md`);
      }
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});
