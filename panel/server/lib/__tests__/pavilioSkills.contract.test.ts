import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// From panel/server/lib/__tests__ up 4 levels reaches the repo root, then skills/.
const REPO_ROOT = join(__dirname, "../../../../");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const OPENCODE_CMD_DIR = join(REPO_ROOT, ".opencode/commands");

const read = (name: string): string =>
  readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");

/**
 * A skill's *procedure*, with its declarative preamble removed: the YAML
 * frontmatter and any `<UPPERCASE-TAG>` block.
 *
 * The ordering assertions below index into the text, and both of those places
 * legitimately *name* the artifacts a skill produces without being where they
 * are written — the frontmatter `description` summarises the output ("a
 * complete OpenSpec change dir — proposal.md, design.md..."), and a
 * `<DEFINITION-OF-DONE>` block lists what must exist for the skill to be
 * finished. Indexing the whole file mistakes either for a write, and reports
 * it as happening before the resolution step that in fact precedes every real
 * one.
 */
const body = (content: string): string => {
  let out = content;
  if (out.startsWith("---")) {
    const end = out.indexOf("\n---", 3);
    if (end !== -1) out = out.slice(end + 4);
  }
  return out.replace(/<([A-Z][A-Z-]*)>[\s\S]*?<\/\1>/g, "");
};

const storage = read("pavilio-openspec-storage");
const grill = read("pavilio-grill");
const writingPlans = read("pavilio-writing-plans");
const executePlan = read("pavilio-execute-plan");
const archive = read("pavilio-archive-plan");
const sessionStart = read("pavilio-session-start");
const manager = read("pavilio-manager");
const handoff = read("pavilio-handoff");

// Every skill this task rewrites — used by the no-CLI sweep.
const MODIFIED = {
  "pavilio-openspec-storage": storage,
  "pavilio-grill": grill,
  "pavilio-writing-plans": writingPlans,
  "pavilio-execute-plan": executePlan,
  "pavilio-archive-plan": archive,
  "pavilio-session-start": sessionStart,
  "pavilio-manager": manager,
  "pavilio-handoff": handoff,
};

describe("pavilio skills — OpenSpec storage contract", () => {
  it("core skills require persisted backend resolution before artifact writes", () => {
    // grill, writing-plans, and archive must reference the shared resolution skill
    // and mention resolving/persisting a backend, ahead of the first artifact write.
    const cases: Array<[string, string, string]> = [
      ["grill", grill, "proposal.md"],
      ["writing-plans", writingPlans, "tasks.md"],
      ["archive", archive, "changes/archive"],
    ];
    for (const [label, raw, writeToken] of cases) {
      const content = body(raw);
      expect(content, `${label} references [[pavilio-openspec-storage]]`).toContain(
        "[[pavilio-openspec-storage]]",
      );
      expect(content, `${label} mentions backend resolution`).toMatch(/backend/i);
      const refIdx = content.indexOf("[[pavilio-openspec-storage]]");
      const writeIdx = content.indexOf(writeToken);
      expect(writeIdx, `${label} contains its write token ${writeToken}`).toBeGreaterThan(-1);
      expect(
        refIdx,
        `${label} references resolution before writing ${writeToken}`,
      ).toBeLessThan(writeIdx);
    }
  });

  it("grill maps output to proposal, design (mermaid), and delta specs under changes/", () => {
    expect(grill).toMatch(/changes\/</);
    expect(grill).toContain("proposal.md");
    expect(grill).toContain("design.md");
    expect(grill).toMatch(/specs\/<capability>\/spec\.md/);
    // Mermaid guidance for design docs is retained.
    expect(grill).toMatch(/mermaid/i);
  });

  it("writing-plans maps the implementation contract to tasks.md", () => {
    expect(writingPlans).toContain("tasks.md");
    expect(writingPlans).toMatch(/changes\/</);
    // Test-first WHEN/THEN task contract survives.
    expect(writingPlans).toMatch(/WHEN/);
    expect(writingPlans).toMatch(/THEN/);
  });

  it("archive folds and moves with skill logic and never invokes a CLI", () => {
    expect(archive).toContain("openspec/specs/");
    expect(archive).toMatch(/changes\/archive/);
    // Skill-owned move logic (git mv), not a CLI.
    expect(archive).toMatch(/git mv/);

    const forbidden = [
      /openspec archive/i,
      /openspec validate/i,
      /openspec init/i,
      /child_process/i,
      /execSync/i,
      /spawnSync/i,
    ];
    for (const [name, content] of Object.entries(MODIFIED)) {
      for (const pattern of forbidden) {
        expect(
          pattern.test(content),
          `${name} must not invoke a CLI (${pattern})`,
        ).toBe(false);
      }
    }
  });

  it("skills derive active work from change dirs, not CURRENT.md", () => {
    expect(sessionStart).toMatch(/changes\//);
    expect(sessionStart).toMatch(/un-?archived/i);
    expect(manager).toMatch(/changes\//);
    // CURRENT.md is gone from the lifecycle-owning skills.
    expect(grill).not.toContain("CURRENT.md");
    expect(archive).not.toContain("CURRENT.md");
    expect(sessionStart).not.toContain("CURRENT.md");
  });

  it("skills preserve one-question and approval gates", () => {
    // Ask-once backend question lives in the shared storage skill.
    expect(storage).toMatch(/ask/i);
    expect(storage).toMatch(/once/i);
    // Grill keeps its one-question interview and hard approval gate.
    expect(grill).toMatch(/one question/i);
    expect(grill).toMatch(/HARD-GATE|approve/i);
  });

  it("configuration switch never implies automatic migration", () => {
    expect(storage).toMatch(/migrat/i);
    expect(storage).toMatch(/(never|without|not).{0,60}migrat/i);
  });

  it("generated OpenCode wrappers point to every authoritative Pavilio skill", () => {
    // Authoritative skills are the skills/pavilio-* directories that contain a SKILL.md.
    const authoritative = readdirSync(SKILLS_DIR)
      .filter((name) => name.startsWith("pavilio-"))
      .filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory())
      .filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")));

    // The two new skills must be part of the authoritative set.
    expect(authoritative).toContain("pavilio-openspec-storage");
    expect(authoritative).toContain("pavilio-openspec-migrate");

    // Every authoritative skill must have a generated OpenCode wrapper.
    const missing = authoritative.filter(
      (name) => !existsSync(join(OPENCODE_CMD_DIR, `${name}.md`)),
    );
    expect(
      missing,
      `missing generated .opencode/commands wrappers for: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
