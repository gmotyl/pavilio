import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir: tmpdir() }) }));

import { readRepos } from "../discovery";

describe("readRepos forge override", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "discovery-forge-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (entries: unknown[]): void => writeFileSync(join(dir, "repos.json"), JSON.stringify(entries));

  it("readRepos keeps a valid forge override", () => {
    write([
      { name: "gl", path: "/nowhere/gl", forge: "gitlab" },
      { name: "gh", path: "/nowhere/gh", forge: "github" },
    ]);
    const [gl, gh] = readRepos(dir, "proj");
    expect(gl.forge).toBe("gitlab");
    expect(gh.forge).toBe("github");
  });

  it("readRepos drops an unknown forge value", () => {
    write([
      { name: "a", path: "/nowhere/a" },
      { name: "b", path: "/nowhere/b", forge: "bitbucket" },
      { name: "c", path: "/nowhere/c", forge: 1 },
    ]);
    const repos = readRepos(dir, "proj");
    expect(repos).toHaveLength(3);
    for (const r of repos) expect(r).not.toHaveProperty("forge");
  });
});
