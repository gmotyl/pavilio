import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// From panel/server/lib/__tests__ up 4 levels reaches the repo root, then skills/.
const migrate = readFileSync(
  join(__dirname, "../../../../skills/pavilio-openspec-migrate/SKILL.md"),
  "utf8",
);

// Ordering assertions apply to the ordered runbook body, not the intro/frontmatter.
const runbookIdx = migrate.indexOf("## Runbook");
const runbook = migrate.slice(runbookIdx);

describe("pavilio-openspec-migrate — mechanical migration contract", () => {
  it("archives shipped active plans before relocating living specs", () => {
    // Shipped/merged active plans fold into living specs via the archive skill FIRST.
    expect(migrate).toContain("[[pavilio-archive-plan]]");
    expect(migrate).toMatch(/merged|shipped/i);
    // Ordering: the archive-shipped step precedes the living-specs relocation step.
    const archiveIdx = runbook.indexOf("[[pavilio-archive-plan]]");
    const specsIdx = runbook.search(/plans\/openspec\/specs\/<area>\/spec\.md/);
    expect(archiveIdx, "runbook references [[pavilio-archive-plan]]").toBeGreaterThan(-1);
    expect(specsIdx, "runbook targets living-spec relocation path").toBeGreaterThan(-1);
    expect(
      archiveIdx,
      "archive-shipped step precedes living-specs relocation",
    ).toBeLessThan(specsIdx);
    // Unshipped active plans are explicitly NOT archived.
    expect(migrate).toMatch(/unshipped/i);
  });

  it("relocates living specs and archives with git mv verbatim", () => {
    expect(migrate).toMatch(/git mv/);
    // Content is unchanged — a move, never a reformat.
    expect(migrate).toMatch(/(content|verbatim).{0,80}(unchanged|preserv)|never.{0,40}reformat/i);
    // Living specs target and archive target.
    expect(migrate).toMatch(/plans\/openspec\/specs\/<area>\/spec\.md/);
    expect(migrate).toMatch(/plans\/openspec\/changes\/archive\//);
  });

  it("maps unshipped active plans to changes/<stem> design/tasks", () => {
    expect(migrate).toMatch(/-design\.md.{0,40}changes\/<stem>\/design\.md/);
    expect(migrate).toMatch(/(-implementation\.md|-plan\.md).{0,60}tasks\.md/);
  });

  it("deletes CURRENT.md only after relocation completes", () => {
    expect(migrate).toContain("CURRENT.md");
    expect(migrate).toMatch(/(delete|retire|remove).{0,60}CURRENT\.md/i);
    // CURRENT.md removal comes after the relocation steps.
    const relocateIdx = runbook.search(/plans\/openspec\/changes\/<stem>/);
    const currentIdx = runbook.indexOf("CURRENT.md");
    expect(relocateIdx, "runbook contains an active-change relocation target").toBeGreaterThan(-1);
    expect(currentIdx, "CURRENT.md retired after relocation").toBeGreaterThan(relocateIdx);
  });

  it("leaves legacy flat plans readable mid-migration", () => {
    expect(migrate).toMatch(/legacy.{0,60}(readable|listed|list)/i);
    expect(migrate).toMatch(/mid-?migration|until.{0,40}(move|migration).{0,40}complet/i);
  });

  it("never invokes a CLI or child process", () => {
    const forbidden = [
      /openspec archive/i,
      /openspec validate/i,
      /openspec init/i,
      /child_process/i,
      /execSync/i,
      /spawnSync/i,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(migrate), `migrate must not invoke a CLI (${pattern})`).toBe(false);
    }
  });
});
