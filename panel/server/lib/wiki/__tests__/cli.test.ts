import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { main, type CliDeps } from "../cli";
import { hashRecord } from "../ledger";
import type { FetchLike } from "../project";

const run = promisify(execFile);
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../scripts/wiki");

const REGISTRY = [
  "| Project | Type | Path |",
  "| ------- | ---- | ---- |",
  "| demo | private | `<root>/projects/demo/` |",
  "",
].join("\n");

let root = "";
let project = "";

function write(rel: string, text: string) {
  const abs = join(project, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const noFetch: FetchLike = async () => {
  throw new Error("fetch must not be called");
};

/** Run `main` in-process and capture its single JSON line and stderr. */
async function cli(argv: string[], extra: Partial<CliDeps> = {}) {
  let out = "";
  let err = "";
  const code = await main(argv, {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    cwd: root,
    env: {},
    workspaceRoot: root,
    fetch: noFetch,
    ...extra,
  });
  expect(out.trim().split("\n")).toHaveLength(1);
  return { code, json: JSON.parse(out), stderr: err };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-cli-"));
  project = join(root, "projects", "demo");
  writeFileSync(join(root, ".projects.local.md"), REGISTRY);
  write("notes/2026-10-01_1000_kickoff.md", "# kickoff\n");
  const source = (concept: string) =>
    `---\ntype: source\ndescription: d\nconcepts: [${concept}]\nentities: [greg]\n---\nbody [[wiki/concepts/speech]]\n`;
  write("wiki/sources/a.md", source("speech"));
  write("wiki/sources/b.md", source("speech"));
  write("wiki/concepts/speech.md", "---\ntype: concept\ndescription: Speech\n---\nbody\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("wiki cli", () => {
  it("dispatches each command and prints json", async () => {
    expect(await cli(["project", "--name", "demo"])).toMatchObject({ code: 0, json: { project: "demo", via: "arg" } });
    expect(await cli(["project", "--cwd", join(project, "notes")])).toMatchObject({
      code: 0,
      json: { project: "demo", via: "cwd" },
    });
    const asked = await cli(["project", "--name", "nope"]);
    expect(asked.code).toBe(2);
    expect(asked.json).toMatchObject({ ask: true });
    expect(typeof asked.json.reason).toBe("string");

    const hash = hashRecord("# kickoff\n");
    const pending = await cli(["pending", "demo"]);
    expect(pending).toMatchObject({ code: 0 });
    expect(pending.json.pending).toEqual([{ path: "notes/2026-10-01_1000_kickoff.md", hash, status: "new" }]);
    expect((await cli(["pending", "demo", "--only", "notes/missing.md"])).json).toEqual({ pending: [] });

    expect(await cli(["record", "demo", "notes/2026-10-01_1000_kickoff.md", hash])).toMatchObject({
      code: 0,
      json: { ok: true },
    });
    expect((await cli(["pending", "demo"])).json).toEqual({ pending: [] });

    expect((await cli(["lock", "take", "demo", "--session", "s1"])).json).toEqual({ held: true, takenOver: false });
    expect((await cli(["lock", "take", "demo", "--session", "s2"])).json).toEqual({ held: false, takenOver: false });
    expect((await cli(["lock", "release", "demo", "--session", "s1"])).json).toEqual({
      held: false,
      takenOver: false,
      released: true,
    });

    const mentions = await cli(["mentions", "demo", "--touched", "concepts/speech,greg"]);
    expect(mentions.code).toBe(0);
    expect(mentions.json.slugs["concepts/speech"]).toEqual(["sources/a.md", "sources/b.md"]);
    expect(mentions.json.qualifying).toEqual(["concepts/speech"]);
    expect(mentions.stderr).toMatch(/"greg" is not namespaced/);

    const index = await cli(["index", "demo"]);
    expect(index.code).toBe(0);
    expect(index.json.written).toContain("index.md");
    expect(index.json.removed).toEqual([]);
    expect(existsSync(join(project, "wiki", "index.md"))).toBe(true);
    write("wiki/sources/untyped.md", "no frontmatter\n");
    const failed = await cli(["index", "demo"]);
    expect(failed).toMatchObject({ code: 1, json: { page: "sources/untyped.md" } });
    expect(typeof failed.json.error).toBe("string");

    const lint = await cli(["lint", "demo"]);
    expect(lint.code).toBe(0);
    expect(Object.keys(lint.json).sort()).toEqual(["broken", "codeIdentifiers", "malformed", "orphans", "stale", "untyped"]);

    mkdirSync(join(root, ".pavilio"), { recursive: true });
    writeFileSync(join(root, ".pavilio", "preferences.json"), JSON.stringify({ "wiki.writerModel": "sonnet", "wiki.sessionStartIngest": false }));
    const config = await cli(["config"]);
    expect(config.code).toBe(0);
    // A foreign workspace root reads its own preferences document.
    expect(config.json).toEqual({ sessionStartIngest: false, writerModel: "sonnet" });

    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const html = `<html><head><title>An Article</title></head><body><article><h1>An Article</h1><p>${words}</p></article></body></html>`;
    const fetchHtml: FetchLike = async () => new Response(html, { headers: { "content-type": "text/html" } });
    const article = await cli(["fetch-article", "demo", "https://example.com/a"], { fetch: fetchHtml });
    expect(article.code).toBe(0);
    expect(article.json.title).toBe("An Article");
    expect(article.json.raw).toMatch(/^raw\/.+\.md$/);
    expect(readFileSync(join(project, "wiki", article.json.raw), "utf8")).toContain("word399");

    const clone = await cli(["clone-repo", "demo", "not a repo url"]);
    expect(clone.code).toBe(1);
    expect(typeof clone.json.error).toBe("string");

    // `<p>` must be a plain, existing project dir.
    for (const bad of ["../demo", "demo/wiki", "missing"]) {
      const res = await cli(["lint", bad]);
      expect(res.code).toBe(1);
      expect(typeof res.json.error).toBe("string");
    }
  });

  it("fails on an unknown command", async () => {
    const res = await cli(["frobnicate"]);
    expect(res.code).toBe(1);
    expect(res.json).toEqual({ error: "unknown command: frobnicate" });
    expect(res.stderr).toMatch(/^usage: scripts\/wiki/);

    const missing = await cli([]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/usage:/);
  });

  it("runs from an unrelated cwd", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "wiki-cli-cwd-"));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, PAVILIO_WORKSPACE_ROOT: root };
      delete env.PAVILIO_TERMINAL_ID;
      const { stdout } = await run("bash", [SCRIPT, "pending", "demo"], { cwd: elsewhere, env });
      expect(JSON.parse(stdout)).toEqual({
        pending: [{ path: "notes/2026-10-01_1000_kickoff.md", hash: hashRecord("# kickoff\n"), status: "new" }],
      });

      const asked = await run("bash", [SCRIPT, "project"], { cwd: elsewhere, env }).catch((e) => e);
      expect(asked.code).toBe(2);
      expect(JSON.parse(asked.stdout)).toMatchObject({ ask: true });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 30_000);
});
