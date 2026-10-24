import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { main, type CliDeps } from "../cli";

let root = "";

/** Run `main` in-process and capture its single JSON line and stderr. */
async function cli(argv: string[], extra: Partial<CliDeps> = {}) {
  let out = "";
  let err = "";
  const code = await main(argv, {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    env: {},
    workspaceRoot: root,
    today: () => "2026-10-22",
    ...extra,
  });
  expect(out.trim().split("\n")).toHaveLength(1);
  return { code, json: JSON.parse(out), stderr: err };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-cli-"));
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(root, ".projects.local.md"), "| Project | Type | Path |\n| --- | --- | --- |\n| demo | private | `projects/demo/` |\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scripts/project", () => {
  it("cli new prints created paths and exit 0", async () => {
    const res = await cli(["new", "tmp-x", "--kind", "research", "--topic", "edge tts voices"]);
    expect(res.code).toBe(0);
    expect(res.json.created).toEqual(expect.arrayContaining(["PROJECT.md", "wiki/raw/.gitkeep", "wiki/index.md"]));
    expect(res.json.created).not.toContain("spikes/.gitkeep");
    const card = readFileSync(join(root, "projects/tmp-x/PROJECT.md"), "utf8");
    expect(card).toContain('topic: "edge tts voices"');
    expect(card).toContain("created: 2026-10-22");

    const plain = await cli(["new", "acme"]);
    expect(plain.code).toBe(0);
    expect(plain.json.created).toContain("STATUS.md");
    expect(readFileSync(join(root, "projects/acme/PROJECT.md"), "utf8")).toContain("kind: project");

    const bad = await cli(["new", "x", "--kind", "blog"]);
    expect(bad.code).toBe(1);
    expect(bad.json.error).toMatch(/--kind/);
    expect(existsSync(join(root, "projects/x"))).toBe(false);

    const unsafe = await cli(["new", "../evil"]);
    expect(unsafe.code).toBe(1);
    expect(unsafe.json.error).toMatch(/invalid project name/);
  });

  it("cli new rejects a name that is not a slug", async () => {
    for (const name of ["Acme", "my project", "-x", ".hidden", "archived", "a/b", "zażółć"]) {
      const res = await cli(["new", name]);
      expect(res.code, name).toBe(1);
      expect(res.json.error, name).toMatch(/invalid project name/);
    }
    expect(existsSync(join(root, "projects/Acme"))).toBe(false);
    expect((await cli(["new", "a1.b_c-d"])).code).toBe(0);
  });

  it("cli new requires a topic for research", async () => {
    const res = await cli(["new", "lab", "--kind", "research"]);
    expect(res.code).toBe(1);
    expect(res.json.error).toMatch(/topic is required for research projects/);
    expect(existsSync(join(root, "projects/lab"))).toBe(false);
    expect((await cli(["new", "lab", "--kind", "research", "--topic", "  "])).code).toBe(1);
  });

  it("cli new exits 2 with reason", async () => {
    mkdirSync(join(root, "projects/acme"), { recursive: true });
    writeFileSync(join(root, "projects/acme/PROJECT.md"), "# Acme\n");
    const taken = await cli(["new", "acme"]);
    expect(taken.code).toBe(2);
    expect(taken.json).toEqual({ ask: true, reason: "exists" });

    mkdirSync(join(root, "projects/archived/old"), { recursive: true });
    const archived = await cli(["new", "old", "--kind", "knowledge"]);
    expect(archived.code).toBe(2);
    expect(archived.json).toEqual({ ask: true, reason: "archived" });
    expect(existsSync(join(root, "projects/old"))).toBe(false);
  });

  it("cli spike-repo prints the JSON result", async () => {
    const home = join(root, "home");
    mkdirSync(home);
    mkdirSync(join(root, "projects/lab"));
    writeFileSync(join(root, "projects/lab/PROJECT.md"), "---\nkind: research\n---\n# Lab\n");
    mkdirSync(join(root, ".pavilio"));
    writeFileSync(join(root, ".pavilio/preferences.json"), JSON.stringify({ "research.spikesRoot": "~/code/spikes" }));

    const first = await cli(["spike-repo", "lab"], { home });
    expect(first.code).toBe(0);
    expect(first.json).toEqual({ path: join(home, "code/spikes/lab"), repo: "created", registered: true });
    expect(existsSync(join(home, "code/spikes/lab/.git"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "projects/lab/repos.json"), "utf8"))).toEqual([
      { name: "lab-spikes", path: "~/code/spikes/lab" },
    ]);

    const again = await cli(["spike-repo", "lab"], { home });
    expect(again).toMatchObject({ code: 0, json: { repo: "existing", registered: false } });

    const missing = await cli(["spike-repo", "ghost"], { home });
    expect(missing.code).toBe(1);
    expect(missing.json.error).toMatch(/ghost/);

    const usage = await cli(["spike-repo"], { home });
    expect(usage.code).toBe(1);
    expect(usage.stderr).toMatch(/spike-repo/);

    mkdirSync(join(home, "code/spikes/busy"), { recursive: true });
    writeFileSync(join(home, "code/spikes/busy/x.txt"), "x");
    mkdirSync(join(root, "projects/busy"));
    writeFileSync(join(root, "projects/busy/PROJECT.md"), "---\nkind: research\n---\n# Busy\n");
    const busy = await cli(["spike-repo", "busy"], { home });
    expect(busy.code).toBe(2);
    expect(busy.json).toMatchObject({ ask: true, reason: "occupied", path: join(home, "code/spikes/busy") });
  });
});
