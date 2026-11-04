import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import { loadConfig } from "../../config.js";
import { machineId } from "../hostname.js";
import { resolveSyncRole } from "../syncRole.js";

// Temp git repos and a real tsx process: this suite lives in node-slow.
const REPO_ROOT = resolve(__dirname, "../../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/sync-role");
const DAY = 24 * 60 * 60;

describe("resolveSyncRole", () => {
  let repo: string;

  function git(args: string[], env: NodeJS.ProcessEnv = {}) {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", env: { ...gitSafeEnv(), ...env } });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  }

  /** Writes the files and commits them, optionally `daysAgo` in the past. */
  function commit(subject: string, files: Record<string, string>, daysAgo = 0) {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), body);
    }
    git(["add", "-A"]);
    const date = `@${Math.floor(Date.now() / 1000) - daysAgo * DAY} +0000`;
    git(["commit", "-q", "--allow-empty", "-m", subject], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }

  const mirrorFile = (id: string) => ({ ".pavilio/sync-mirror.json": JSON.stringify({ mirror: id }) + "\n" });
  const role = (id = "spock") => resolveSyncRole({ repo, ref: "main", machineId: id });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "syncrole-"));
    git(["init", "-q"]);
    git(["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(["config", "user.email", "t@test"]);
    git(["config", "user.name", "t"]);
    commit("seed", { "README.md": "seed\n" }, 90);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("mirror when the file names this machine", async () => {
    commit("auto-sync mac 2026-11-03T13:38:28.980Z", { "projects/p/time/mac.jsonl": "{}\n" });
    commit("chore(sync): promote spock to mirror", mirrorFile("spock"));
    expect(await role("spock")).toBe("mirror");
    // the machine id is compared in its sanitized form
    expect(await role("SPOCK")).toBe("mirror");
  });

  it("consumer when the file names another machine", async () => {
    commit("chore(sync): promote mac to mirror", mirrorFile("mac"));
    expect(await role("spock")).toBe("consumer");
  });

  it("single without a file and without other machines", async () => {
    commit("auto-sync spock 2026-11-03T13:38:28.980Z", { "projects/p/time/spock.jsonl": "{}\n" });
    commit("notes", { "projects/p/note.md": "n\n" });
    expect(await role("spock")).toBe("single");
  });

  it("unassigned without a file when another machine synced within 30 days", async () => {
    commit("auto-sync spock 2026-11-03T13:38:28.980Z", { "projects/p/time/spock.jsonl": "{}\n" });
    commit("auto-sync mac 2026-11-01T10:00:00.000Z", {}, 20);
    expect(await role("spock")).toBe("unassigned");
  });

  it("unassigned when only another machine's time file shows within 30 days", async () => {
    commit("notes", { "projects/p/sub/time/mac.jsonl": "{}\n" }, 5);
    expect(await role("spock")).toBe("unassigned");
  });

  it("ignores other machines older than the window", async () => {
    commit("auto-sync mac 2026-08-01T10:00:00.000Z", { "projects/p/time/mac.jsonl": "{}\n" }, 60);
    commit("auto-sync spock 2026-11-03T13:38:28.980Z", { "projects/p/time/spock.jsonl": "{}\n" });
    expect(await role("spock")).toBe("single");
    // a wider window does see it
    expect(await resolveSyncRole({ repo, ref: "main", machineId: "spock", days: 90 })).toBe("unassigned");
  });

  it("a malformed mirror file is unassigned", async () => {
    commit("broken", { ".pavilio/sync-mirror.json": "{ not json" });
    expect(await role("spock")).toBe("unassigned");
    commit("wrong shape", { ".pavilio/sync-mirror.json": JSON.stringify({ mirror: 42 }) });
    expect(await role("spock")).toBe("unassigned");
    commit("empty id", { ".pavilio/sync-mirror.json": JSON.stringify({ mirror: "  " }) });
    expect(await role("unknown")).toBe("unassigned");
  });

  it("reads the mirror file from the ref, never the working tree", async () => {
    mkdirSync(join(repo, ".pavilio"), { recursive: true });
    writeFileSync(join(repo, ".pavilio/sync-mirror.json"), JSON.stringify({ mirror: "spock" }));
    expect(await role("spock")).toBe("single");
  });

  it("detects another machine from a time file under a non-ASCII project path", async () => {
    commit("notes", { "projects/żółw/time/mac.jsonl": "{}\n" }, 5);
    expect(await role("spock")).toBe("unassigned");
  });

  it("scripts/sync-role treats a flag value that is itself a flag as a usage error", () => {
    const res = spawnSync("bash", [SCRIPT, "--ref", "--repo", repo], { cwd: repo, encoding: "utf8", env: gitSafeEnv() });
    expect(res.status, res.stderr).toBe(2);
    expect(res.stderr).toMatch(/--ref needs a value/);
  });

  it("rejects a ref that does not exist", async () => {
    await expect(resolveSyncRole({ repo, ref: "origin/nope", machineId: "spock" })).rejects.toThrow(/origin\/nope/);
  });

  it("scripts/sync-role prints the role and exits 0", async () => {
    await loadConfig();
    commit("chore(sync): promote", mirrorFile(machineId()));
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const res = spawnSync("bash", [SCRIPT, "--ref", "origin/main"], { cwd: repo, encoding: "utf8", env: gitSafeEnv() });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toBe("mirror\n");
    // --repo points it at another directory, and origin/main is the default ref
    const other = spawnSync("bash", [SCRIPT, "--repo", repo], { cwd: tmpdir(), encoding: "utf8", env: gitSafeEnv() });
    expect(other.status, other.stderr).toBe(0);
    expect(other.stdout).toBe("mirror\n");
  });
});
