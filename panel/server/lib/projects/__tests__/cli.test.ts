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
    expect(res.json.created).toEqual(expect.arrayContaining(["PROJECT.md", "spikes/.gitkeep", "wiki/raw/.gitkeep", "wiki/index.md"]));
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
});
