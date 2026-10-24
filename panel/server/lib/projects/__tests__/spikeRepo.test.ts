import { execFileSync } from "child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readProject } from "../../discovery";
import { gitEnv } from "../../wiki/clone-repo";
import { ensureSpikeRepo } from "../spikeRepo";

let tmp = "";
let projectsDir = "";
let home = "";

/** A project dir with a `PROJECT.md` of the given kind (no kind → no frontmatter). */
function makeProject(name: string, kind?: string) {
  mkdirSync(join(projectsDir, name), { recursive: true });
  const card = kind ? `---\nkind: ${kind}\n---\n# ${name}\n` : `# ${name}\n`;
  writeFileSync(join(projectsDir, name, "PROJECT.md"), card);
}

function reposJson(name: string): unknown {
  return JSON.parse(readFileSync(join(projectsDir, name, "repos.json"), "utf8"));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "spike-repo-"));
  projectsDir = join(tmp, "projects");
  home = join(tmp, "home");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("ensureSpikeRepo", () => {
  it("creates and registers the spikes repo on first run", () => {
    makeProject("lab", "research");
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/git/prv/spikes", home });
    const path = join(home, "git/prv/spikes/lab");
    expect(res).toEqual({ ok: true, path, repo: "created", registered: true });
    expect(existsSync(join(path, ".git"))).toBe(true);
    expect(reposJson("lab")).toEqual([{ name: "lab-spikes", path: "~/git/prv/spikes/lab" }]);
  });

  it("second run is a no-op", () => {
    makeProject("lab", "research");
    const args = { projectsDir, project: "lab", spikesRoot: "~/spikes", home };
    ensureSpikeRepo(args);
    const before = readFileSync(join(projectsDir, "lab/repos.json"), "utf8");
    const res = ensureSpikeRepo(args);
    expect(res).toEqual({ ok: true, path: join(home, "spikes/lab"), repo: "existing", registered: false });
    expect(readFileSync(join(projectsDir, "lab/repos.json"), "utf8")).toBe(before);
  });

  it("existing git dir is only registered", () => {
    makeProject("lab", "research");
    const path = join(home, "spikes/lab");
    mkdirSync(join(path, ".git"), { recursive: true });
    writeFileSync(join(path, "keep.txt"), "x");
    writeFileSync(
      join(projectsDir, "lab/repos.json"),
      JSON.stringify([{ name: "app", path: "~/code/app" }]),
    );
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
    expect(res).toEqual({ ok: true, path, repo: "existing", registered: true });
    expect(readdirSync(path).sort()).toEqual([".git", "keep.txt"]);
    expect(reposJson("lab")).toEqual([
      { name: "app", path: "~/code/app" },
      { name: "lab-spikes", path: "~/spikes/lab" },
    ]);
  });

  it("refuses a non-research or missing project", () => {
    makeProject("plain", "project");
    makeProject("bare");
    for (const project of ["plain", "bare", "ghost", "../evil"]) {
      const res = ensureSpikeRepo({ projectsDir, project, spikesRoot: "~/spikes", home });
      expect(res, project).toMatchObject({ ok: false, code: 1 });
    }
    expect(existsSync(join(home, "spikes"))).toBe(false);
    expect(existsSync(join(projectsDir, "plain/repos.json"))).toBe(false);
    expect(existsSync(join(projectsDir, "bare/repos.json"))).toBe(false);
  });

  it("asks on an occupied non-git dir", () => {
    makeProject("lab", "research");
    const path = join(home, "spikes/lab");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "notes.txt"), "mine");
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
    expect(res).toMatchObject({ ok: false, code: 2, path });
    expect(res.ok === false && res.error).toContain(path);
    expect(readdirSync(path)).toEqual(["notes.txt"]);
    expect(existsSync(join(projectsDir, "lab/repos.json"))).toBe(false);
  });

  it("leaves a malformed repos.json untouched", () => {
    makeProject("lab", "research");
    for (const text of ["[{ broken", '{"name":"x"}']) {
      writeFileSync(join(projectsDir, "lab/repos.json"), text);
      const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
      expect(res, text).toMatchObject({ ok: false, code: 1 });
      expect(readFileSync(join(projectsDir, "lab/repos.json"), "utf8")).toBe(text);
    }
    expect(existsSync(join(home, "spikes"))).toBe(false);
  });

  it("honours a custom spikes root and keeps ~ in repos.json", () => {
    makeProject("lab", "research");
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/code/spikes/", home });
    expect(res).toEqual({ ok: true, path: join(home, "code/spikes/lab"), repo: "created", registered: true });
    expect(existsSync(join(home, "code/spikes/lab/.git"))).toBe(true);
    expect(reposJson("lab")).toEqual([{ name: "lab-spikes", path: "~/code/spikes/lab" }]);

    // An absolute root is recorded as written too.
    makeProject("lab2", "research");
    const abs = join(tmp, "abs-spikes");
    const res2 = ensureSpikeRepo({ projectsDir, project: "lab2", spikesRoot: abs, home });
    expect(res2).toMatchObject({ ok: true, path: join(abs, "lab2"), repo: "created" });
    expect(reposJson("lab2")).toEqual([{ name: "lab2-spikes", path: `${abs}/lab2` }]);
  });

  it("git init ignores an exported GIT_DIR", () => {
    makeProject("lab", "research");
    const decoy = join(tmp, "decoy");
    mkdirSync(decoy, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: decoy, env: gitEnv(), stdio: "pipe" });
    const snapshot = (dir: string): string =>
      readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().join("\n");
    const before = snapshot(decoy);

    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(decoy, ".git");
    process.env.GIT_WORK_TREE = decoy;
    try {
      const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
      expect(res).toMatchObject({ ok: true, repo: "created" });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(existsSync(join(home, "spikes/lab/.git"))).toBe(true);
    expect(snapshot(decoy)).toBe(before);
  });

  it("an expanded path in repos.json counts as registered for a ~ root", () => {
    makeProject("lab", "research");
    const text = JSON.stringify([{ name: "lab-spikes", path: join(home, "spikes/lab") }]);
    writeFileSync(join(projectsDir, "lab/repos.json"), text);
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
    expect(res).toMatchObject({ ok: true, registered: false });
    expect(readFileSync(join(projectsDir, "lab/repos.json"), "utf8")).toBe(text);
  });

  it("a relative spikes root is refused", () => {
    makeProject("lab", "research");
    const before = readdirSync(tmp, { recursive: true, encoding: "utf8" }).sort();
    const res = ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "spikes", home });
    expect(res).toMatchObject({ ok: false, code: 1 });
    expect(readdirSync(tmp, { recursive: true, encoding: "utf8" }).sort()).toEqual(before);
    expect(existsSync(join(process.cwd(), "spikes/lab"))).toBe(false);
  });

  it("discovery lists the registered spikes repo", () => {
    makeProject("lab", "research");
    ensureSpikeRepo({ projectsDir, project: "lab", spikesRoot: "~/spikes", home });
    expect(readProject(projectsDir, "lab").repos).toEqual([{ name: "lab-spikes", path: "~/spikes/lab" }]);
  });
});
