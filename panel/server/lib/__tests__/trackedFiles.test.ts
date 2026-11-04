import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import { trackedFileNames } from "../trackedFiles.js";

// Temp git repos: this suite lives in node-slow.
describe("trackedFileNames", () => {
  let root: string;

  function git(cwd: string, args: string[]) {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: gitSafeEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tracked-files-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("names the files git tracks directly in the directory", async () => {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "t@test"]);
    git(root, ["config", "user.name", "t"]);
    const prefs = join(root, ".pavilio", "preferences");
    mkdirSync(join(prefs, "nested"), { recursive: true });
    for (const name of ["mac.json", "spock.json", "nested/deep.json"]) writeFileSync(join(prefs, name), "{}");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "seed"]);
    // Untracked: not committed, not named.
    writeFileSync(join(prefs, "laptop.json"), "{}");

    expect((await trackedFileNames(prefs))?.sort()).toEqual(["mac.json", "spock.json"]);
  });

  it("is an empty list for a directory with nothing tracked in a repository", async () => {
    git(root, ["init", "-q"]);
    const prefs = join(root, ".pavilio", "preferences");
    mkdirSync(prefs, { recursive: true });
    writeFileSync(join(prefs, "mac.json"), "{}");

    expect(await trackedFileNames(prefs)).toEqual([]);
  });

  it("is undefined outside a git repository or for a missing directory", async () => {
    expect(await trackedFileNames(root)).toBeUndefined();
    expect(await trackedFileNames(join(root, "missing"))).toBeUndefined();
  });
});
