import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import { hashRecord } from "../ledger";

// scripts/wiki cold-starts a real tsx process per call, so this suite lives in
// node-slow; the command logic itself is covered in-process by cli.test.ts.
const run = promisify(execFile);
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../scripts/wiki");

const REGISTRY = [
  "| Project | Type | Path |",
  "| ------- | ---- | ---- |",
  "| demo | private | `<root>/projects/demo/` |",
  "",
].join("\n");

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-cli-script-"));
  writeFileSync(join(root, ".projects.local.md"), REGISTRY);
  const notes = join(root, "projects", "demo", "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "2026-10-01_1000_kickoff.md"), "# kickoff\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scripts/wiki", () => {
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
  });
});
