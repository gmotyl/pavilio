import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../../../");
const SETUP_OPENCODE = join(REPO_ROOT, "scripts/setup:opencode");
const DEFAULT_ROOT = "/srv/git/prv/projects";

function sameDirectory(a: string, b: string): boolean {
  try {
    const aStat = statSync(a);
    const bStat = statSync(b);
    return aStat.dev === bStat.dev && aStat.ino === bStat.ino;
  } catch {
    return false;
  }
}

function runSetup(script: string, outRoot: string, workspaceRoot?: string) {
  const env = { ...process.env, PAVILIO_OPENCODE_OUT: outRoot };
  delete env.PAVILIO_WORKSPACE_ROOT;
  if (workspaceRoot !== undefined) env.PAVILIO_WORKSPACE_ROOT = workspaceRoot;
  return spawnSync("bash", [script], { env, encoding: "utf8" });
}

function generatedTemplates(outRoot: string): Record<string, { template?: string }> {
  return JSON.parse(readFileSync(join(outRoot, "opencode.json"), "utf8")).command;
}

describe("OpenCode workspace path selection", () => {
  it("setup uses matching default workspace candidate for generated paths", () => {
    const outRoot = mkdtempSync(join(tmpdir(), "pavilio-opencode-default-"));
    try {
      const result = runSetup(SETUP_OPENCODE, outRoot);
      expect(result.status, result.stderr).toBe(0);
      const selectedRoot = sameDirectory(DEFAULT_ROOT, REPO_ROOT)
        ? DEFAULT_ROOT
        : REPO_ROOT;
      expect(generatedTemplates(outRoot)["pavilio-session-start"]?.template).toContain(
        `${selectedRoot}/skills/pavilio-session-start/SKILL.md`,
      );
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("setup uses a valid explicit workspace override", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pavilio-opencode-override-"));
    const outRoot = join(fixture, "out");
    const aliasRoot = join(fixture, "workspace-alias");
    try {
      symlinkSync(REPO_ROOT, aliasRoot, "dir");
      const result = runSetup(SETUP_OPENCODE, outRoot, aliasRoot);
      expect(result.status, result.stderr).toBe(0);
      expect(generatedTemplates(outRoot)["pavilio-session-start"]?.template).toContain(
        `${aliasRoot}/skills/pavilio-session-start/SKILL.md`,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("setup rejects relative, inaccessible, and different-repository overrides without fallback", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pavilio-opencode-invalid-"));
    const outRoot = join(fixture, "out");
    const otherRepo = join(fixture, "other-repo");
    mkdirSync(otherRepo);
    try {
      const cases = [
        ["relative/workspace", "absolute"],
        [join(fixture, "missing-workspace"), "inaccessible"],
        [otherRepo, "same repository"],
      ];
      for (const [override, diagnostic] of cases) {
        const result = runSetup(SETUP_OPENCODE, outRoot, override);
        expect(result.status, `override ${override} unexpectedly succeeded`).not.toBe(0);
        expect(result.stderr).toContain("PAVILIO_WORKSPACE_ROOT");
        expect(result.stderr).toContain(diagnostic);
        expect(existsSync(join(outRoot, "opencode.json"))).toBe(false);
        rmSync(outRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("setup falls back to invocation root when the default candidate is unavailable or mismatched", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pavilio-opencode-fallback-"));
    const repoRoot = join(fixture, "repo");
    const outRoot = join(fixture, "out");
    const skillsRoot = join(repoRoot, "skills", "fixture-skill");
    const script = join(repoRoot, "scripts/setup:opencode");
    try {
      mkdirSync(skillsRoot, { recursive: true });
      mkdirSync(join(repoRoot, "scripts"), { recursive: true });
      writeFileSync(join(skillsRoot, "SKILL.md"), "# fixture\n");
      copyFileSync(SETUP_OPENCODE, script);
      const result = runSetup(script, outRoot);
      expect(result.status, result.stderr).toBe(0);
      expect(generatedTemplates(outRoot)["fixture-skill"]?.template).toContain(
        `${repoRoot}/skills/fixture-skill/SKILL.md`,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("setup preserves the selected workspace in opencode.json path entries", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pavilio-opencode-config-"));
    const outRoot = join(fixture, "out");
    const aliasRoot = join(fixture, "workspace-alias");
    try {
      symlinkSync(REPO_ROOT, aliasRoot, "dir");
      const result = runSetup(SETUP_OPENCODE, outRoot, aliasRoot);
      expect(result.status, result.stderr).toBe(0);
      const config = readFileSync(join(outRoot, "opencode.json"), "utf8");
      expect(config).toContain(`${aliasRoot}/skills/`);
      expect(config).not.toContain(`${REPO_ROOT}/skills/`);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
