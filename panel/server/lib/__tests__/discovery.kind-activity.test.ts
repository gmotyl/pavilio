import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";
vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));

import { discoverProjects } from "../discovery";

function makeProject(
  name: string,
  opts: { card?: string; progress?: string[]; wikiLog?: string } = {},
): void {
  const dir = join(projectsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PROJECT.md"), opts.card ?? `# ${name}\n`);
  if (opts.progress) {
    mkdirSync(join(dir, "progress"));
    for (const f of opts.progress) writeFileSync(join(dir, "progress", f), "x\n");
  }
  if (opts.wikiLog !== undefined) {
    mkdirSync(join(dir, "wiki"));
    writeFileSync(join(dir, "wiki", "log.md"), opts.wikiLog);
  }
}

const row = (name: string) => discoverProjects().find((p) => p.name === name)!;

describe("discoverProjects kind and lastActivity", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "discovery-kind-"));
  });
  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("kind comes from PROJECT.md frontmatter, default project", () => {
    makeProject("topic", { card: "---\nkind: research\n---\n# Topic\n" });
    makeProject("plain");
    expect(row("topic").kind).toBe("research");
    expect(row("plain").kind).toBe("project");
  });

  it("lastActivity is the later of progress date and wiki log date", () => {
    makeProject("both", {
      progress: ["2026-08-15-a.md", "2026-09-01-x.md"],
      wikiLog: "# Log\n\n## 2026-10-20 08:00 query\n\n## 2026-10-21 09:53 ingest\n",
    });
    expect(row("both").lastActivity).toBe("2026-10-21");

    makeProject("progress-newer", {
      progress: ["2026-10-22-y.md"],
      wikiLog: "## 2026-10-21 09:53 ingest\n",
    });
    expect(row("progress-newer").lastActivity).toBe("2026-10-22");
  });

  it("lastActivity uses the only available source", () => {
    makeProject("progress-only", { progress: ["2026-09-01-x.md"] });
    makeProject("wiki-only", { wikiLog: "## 2026-10-21 09:53 ingest\n" });
    expect(row("progress-only").lastActivity).toBe("2026-09-01");
    expect(row("wiki-only").lastActivity).toBe("2026-10-21");
  });

  it("lastActivity is null with no progress and no wiki log", () => {
    makeProject("idle");
    expect(row("idle").lastActivity).toBeNull();
  });

  it("bracketed log dates count, like the harvest reader accepts", () => {
    makeProject("bracketed", {
      progress: ["2026-09-01-x.md"],
      wikiLog: "# Log\n\n## 2026-10-01 08:00 ingest\n\n## [2026-10-12] harvest\n\n## [2026-10-13 14:05] query\n",
    });
    expect(row("bracketed").lastActivity).toBe("2026-10-13");
  });

  it("undated log headings are ignored", () => {
    makeProject("undated", {
      progress: ["2026-09-01-x.md"],
      wikiLog: "# Log\n\n## Notes\n\n## later 2026-12-01\n",
    });
    makeProject("undated-only", { wikiLog: "## Notes\n" });
    expect(row("undated").lastActivity).toBe("2026-09-01");
    expect(row("undated-only").lastActivity).toBeNull();
  });

  it("non-dated progress files are ignored", () => {
    makeProject("briefing", {
      progress: ["2026-09-01-x.md", "BRIEFING.md", "handoff-foo.md"],
    });
    makeProject("briefing-only", { progress: ["BRIEFING.md"] });
    expect(row("briefing").lastActivity).toBe("2026-09-01");
    expect(row("briefing").latestProgressDate).toBe("2026-09-01");
    expect(row("briefing-only").lastActivity).toBeNull();
    expect(row("briefing-only").latestProgressDate).toBeNull();
  });
});
