import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { hashRecord, pendingRecords, recordIngested } from "../ledger";

let projectDir = "";
const TODAY = "2026-10-20";

function write(rel: string, text: string) {
  const abs = join(projectDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const read = (rel: string) => readFileSync(join(projectDir, rel), "utf8");
const paths = () => pendingRecords(projectDir, { today: TODAY }).map((p) => p.path);

function seed() {
  write("notes/2026-10-01_1000_kickoff.md", "# kickoff\n");
  write("notes/log/2026-10-02_transcript.md", "# transcript\n");
  write("memo/2026-10-03_1200_idea.md", "# idea\n");
  write("progress/2026-10-19-yesterday.md", "# yesterday\n");
  write(`progress/${TODAY}-today.md`, "# today\n");
  write("adr/0001-first.md", "# adr\n");
  const change = "plans/openspec/changes/archive/2026-10-01-thing";
  write(`${change}/proposal.md`, "# proposal\n");
  write(`${change}/design.md`, "# design\n");
  write(`${change}/tasks.md`, "# tasks\n");
  write(`${change}/specs/cap/spec.md`, "# delta\n");
  // An active (un-archived) change is not closed yet.
  write("plans/openspec/changes/2026-10-20-open/proposal.md", "# open\n");
  write("CONTEXT.md", "# glossary\n");
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wiki-ledger-"));
  seed();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("ledger", () => {
  it("lists closed record kinds as new", () => {
    const pending = pendingRecords(projectDir, { today: TODAY });
    expect(pending.map((p) => p.path)).toEqual([
      "adr/0001-first.md",
      "memo/2026-10-03_1200_idea.md",
      "notes/2026-10-01_1000_kickoff.md",
      "plans/openspec/changes/archive/2026-10-01-thing/design.md",
      "plans/openspec/changes/archive/2026-10-01-thing/proposal.md",
      "progress/2026-10-19-yesterday.md",
    ]);
    expect(pending.every((p) => p.status === "new")).toBe(true);
    expect(pending[0].hash).toBe(hashRecord("# adr\n"));
    expect(pending[0].hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("includes unledgered top-level raw snapshots, not subdirs or repo clones", () => {
    write("wiki/raw/article-x.md", "# article\n");
    write("wiki/raw/CONTEXT-2026-10-20.md", "# snapshot\n");
    write("wiki/raw/context-sections/a.md", "# section\n");
    write("wiki/raw/repos/acme-widget/README.md", "# readme\n");
    write("wiki/raw/notes.txt", "not markdown\n");
    recordIngested(projectDir, "wiki/raw/CONTEXT-2026-10-20.md", hashRecord("# snapshot\n"));

    const raw = pendingRecords(projectDir, { today: TODAY }).filter((p) => p.path.startsWith("wiki/"));
    expect(raw).toEqual([{ path: "wiki/raw/article-x.md", hash: hashRecord("# article\n"), status: "new" }]);

    // A refreshed snapshot is pending again, as changed.
    write("wiki/raw/CONTEXT-2026-10-20.md", "# snapshot v2\n");
    expect(pendingRecords(projectDir, { today: TODAY }).find((p) => p.path === "wiki/raw/CONTEXT-2026-10-20.md")?.status).toBe(
      "changed",
    );
  });

  it("skips verbatim transcripts under notes/log", () => {
    write("notes/log/nested/2026-10-04_transcript.md", "# transcript\n");
    expect(paths().filter((p) => p.startsWith("notes/log/"))).toEqual([]);
    // The processed note itself is still a record.
    expect(paths()).toContain("notes/2026-10-01_1000_kickoff.md");
  });

  it("accepts underscore-dated progress files", () => {
    write("progress/2026-10-18_1400_session.md", "# underscore\n");
    write(`progress/${TODAY}_0900_open.md`, "# today\n");
    expect(paths()).toContain("progress/2026-10-18_1400_session.md");
    expect(paths()).not.toContain(`progress/${TODAY}_0900_open.md`);
  });

  it("excludes today's progress", () => {
    expect(paths()).not.toContain(`progress/${TODAY}-today.md`);
    // The default clock is the local date, so a file dated today is excluded without `today`.
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    write(`progress/${local}-now.md`, "# now\n");
    expect(pendingRecords(projectDir).map((p) => p.path)).not.toContain(`progress/${local}-now.md`);
  });

  it("excludes tasks.md and delta specs of archived changes", () => {
    const all = paths();
    expect(all.some((p) => p.endsWith("/tasks.md"))).toBe(false);
    expect(all.some((p) => p.includes("/specs/"))).toBe(false);
  });

  it("skips ledgered unchanged records", () => {
    write("wiki/log.md", `# Log\n\n- ingested: adr/0001-first.md #${hashRecord("# adr\n")}\n`);
    expect(paths()).not.toContain("adr/0001-first.md");
    expect(paths()).toHaveLength(5);
  });

  it("reports changed hash as changed", () => {
    // The latest ledger line for a path wins.
    write(
      "wiki/log.md",
      `- ingested: adr/0001-first.md #${hashRecord("# adr\n")}\n- ingested: adr/0001-first.md #000000000000\n`,
    );
    const adr = pendingRecords(projectDir, { today: TODAY }).find((p) => p.path === "adr/0001-first.md");
    expect(adr).toEqual({ path: "adr/0001-first.md", hash: hashRecord("# adr\n"), status: "changed" });
  });

  it("only restricts to one path", () => {
    expect(pendingRecords(projectDir, { today: TODAY, only: "memo/2026-10-03_1200_idea.md" })).toEqual([
      { path: "memo/2026-10-03_1200_idea.md", hash: hashRecord("# idea\n"), status: "new" },
    ]);
    // An absolute path inside the project is normalised to a project-relative one.
    expect(
      pendingRecords(projectDir, { today: TODAY, only: join(projectDir, "adr", "0001-first.md") }).map((p) => p.path),
    ).toEqual(["adr/0001-first.md"]);
    // A path outside the record kinds is still considered when it exists.
    expect(pendingRecords(projectDir, { today: TODAY, only: "CONTEXT.md" }).map((p) => p.path)).toEqual(["CONTEXT.md"]);
    expect(pendingRecords(projectDir, { today: TODAY, only: "notes/missing.md" })).toEqual([]);
    write("wiki/log.md", `- ingested: CONTEXT.md #${hashRecord("# glossary\n")}\n`);
    expect(pendingRecords(projectDir, { today: TODAY, only: "CONTEXT.md" })).toEqual([]);
  });

  it("record appends a ledger line", () => {
    recordIngested(projectDir, "adr/0001-first.md", "abcdef012345");
    expect(read("wiki/log.md")).toBe("- ingested: adr/0001-first.md #abcdef012345\n");

    // Existing content without a trailing newline is kept intact.
    write("wiki/log.md", "# Log\n\n- query: x");
    const hash = hashRecord("# idea\n");
    recordIngested(projectDir, "memo/2026-10-03_1200_idea.md", hash);
    expect(read("wiki/log.md")).toBe(`# Log\n\n- query: x\n- ingested: memo/2026-10-03_1200_idea.md #${hash}\n`);
    expect(paths()).not.toContain("memo/2026-10-03_1200_idea.md");
  });
});
