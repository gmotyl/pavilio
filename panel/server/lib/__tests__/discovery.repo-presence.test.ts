import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";
vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));

import { readProject } from "../discovery";

const PROJECT = "proj";

function writeRepos(entries: unknown[]): void {
  const dir = join(projectsDir, PROJECT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "repos.json"), JSON.stringify(entries));
}

const repos = () => readProject(projectsDir, PROJECT).repos;

describe("readProject repo presence", () => {
  let scratch = "";
  let savedHome: string | undefined;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "discovery-presence-"));
    scratch = mkdtempSync(join(tmpdir(), "discovery-presence-scratch-"));
    savedHome = process.env.HOME;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    vi.restoreAllMocks();
    rmSync(projectsDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it("marks an existing directory present and keeps its path verbatim", () => {
    const repoDir = join(scratch, "repo");
    mkdirSync(repoDir);
    writeRepos([{ name: "repo", path: repoDir }]);
    expect(repos()).toEqual([{ name: "repo", path: repoDir, present: true }]);
  });

  it("flags a non-blank string remote as cloneable and never sends the URL", () => {
    const gone = join(scratch, "gone");
    writeRepos([
      { name: "a", path: gone, remote: "  https://bob:s3cret@github.com/o/a.git?sig=t0k " },
      { name: "b", path: gone, remote: "   " },
      { name: "c", path: gone, remote: 42 },
    ]);
    expect(repos()).toEqual([
      { name: "a", path: gone, present: false, cloneable: true },
      { name: "b", path: gone, present: false },
      { name: "c", path: gone, present: false },
    ]);
  });

  it("never logs a skipped entry's remote", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeRepos([{ name: "x", path: "", remote: "https://bob:s3cret@host/o/x.git?sig=t0k" }]);
    expect(repos()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/s3cret|t0k/);
  });

  it("keeps a missing entry in file order with present false", () => {
    const here = join(scratch, "here");
    const gone = join(scratch, "gone");
    mkdirSync(here);
    writeRepos([
      { name: "here", path: here },
      { name: "gone", path: gone },
    ]);
    expect(repos()).toEqual([
      { name: "here", path: here, present: true },
      { name: "gone", path: gone, present: false },
    ]);
  });

  it("expands ~ and ~/ before checking presence", () => {
    process.env.HOME = scratch;
    mkdirSync(join(scratch, "code"));
    writeRepos([
      { name: "home", path: "~" },
      { name: "code", path: "~/code" },
    ]);
    expect(repos()).toEqual([
      { name: "home", path: "~", present: true },
      { name: "code", path: "~/code", present: true },
    ]);
  });

  it("normalises the path before checking presence", () => {
    mkdirSync(join(scratch, "spikes"));
    // `old` does not exist, so the raw spelling cannot be stat'ed; the
    // normalised path (the one git routes run in) can.
    const spelled = join(scratch, "old") + "/../spikes";
    writeRepos([{ name: "spikes", path: spelled }]);
    expect(repos()).toEqual([{ name: "spikes", path: spelled, present: true }]);
  });

  it("treats a path that names a file as not present", () => {
    const file = join(scratch, "file.txt");
    writeFileSync(file, "x\n");
    writeRepos([{ name: "file", path: file }]);
    expect(repos()).toEqual([{ name: "file", path: file, present: false }]);
  });

  it("re-derives presence on every read", () => {
    const later = join(scratch, "later");
    writeRepos([{ name: "later", path: later }]);
    expect(repos()[0].present).toBe(false);
    mkdirSync(later);
    expect(repos()[0].present).toBe(true);
  });

  it("skips an entry without a string name or path and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = join(scratch, "ok");
    mkdirSync(ok);
    writeRepos([
      { name: "ok", path: ok },
      { name: "no-path" },
      { path: ok },
      { name: 42, path: ok },
      { name: "bad-path", path: 7 },
      { name: "bad-openspec", path: ok, openspec: "nope" },
      { name: "missing", path: join(scratch, "missing") },
    ]);
    expect(repos()).toEqual([
      { name: "ok", path: ok, present: true },
      { name: "missing", path: join(scratch, "missing"), present: false },
    ]);
    const malformedWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes("skipping repo entry"),
    );
    expect(malformedWarnings).toHaveLength(4);
  });

  it("skips an entry with an empty path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = join(scratch, "ok");
    mkdirSync(ok);
    writeRepos([
      { name: "empty", path: "" },
      { name: "blank", path: "   " },
      { name: "ok", path: ok },
    ]);
    // An empty path would resolve to the server cwd and count as present, so
    // git calls for it would silently hit the workspace repository.
    expect(repos()).toEqual([{ name: "ok", path: ok, present: true }]);
    const malformedWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes("skipping repo entry"),
    );
    expect(malformedWarnings).toHaveLength(2);
  });

  it("keeps an entry whose path cannot be stat'ed as not present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A symlink loop makes stat throw ELOOP rather than return "no entry".
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    symlinkSync(b, a);
    symlinkSync(a, b);
    writeRepos([{ name: "loop", path: a }]);
    expect(repos()).toEqual([{ name: "loop", path: a, present: false }]);
    const openspecWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("openspec"));
    expect(openspecWarnings).toHaveLength(0);
  });
});
