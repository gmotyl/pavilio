import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncRepo } from "../syncRepo.js";

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

describe("syncRepo", () => {
  let root: string, remote: string, mac: string, win: string;

  function clone(name: string) {
    const dir = join(root, name);
    git(root, "clone", "--quiet", remote, dir);
    git(dir, "config", "user.email", `${name}@test`);
    git(dir, "config", "user.name", name);
    return dir;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "syncrepo-"));
    remote = join(root, "remote.git");
    git(root, "init", "--quiet", "--bare", remote);
    // seed
    const seed = join(root, "seed");
    git(root, "clone", "--quiet", remote, seed);
    git(seed, "config", "user.email", "seed@test");
    git(seed, "config", "user.name", "seed");
    mkdirSync(join(seed, "projects/p/time"), { recursive: true });
    writeFileSync(join(seed, "projects/p/note.md"), "base\n");
    writeFileSync(join(seed, "projects/p/time/mac.jsonl"), "0\n");
    writeFileSync(join(seed, ".gitattributes"), "projects/**/time/*.jsonl merge=union\n");
    git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed"); git(seed, "push", "-q", "origin", "HEAD:main");
    mac = clone("mac"); win = clone("win");
  }, 30_000);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const opts = (h: string) => ({ dataPaths: ["projects/"], hostname: h });

  it("converges disjoint edits on two machines with linear history", async () => {
    writeFileSync(join(mac, "projects/p/mac-note.md"), "mac\n");
    writeFileSync(join(win, "projects/p/win-note.md"), "win\n");
    const r1 = await syncRepo(mac, opts("mac"));
    expect(r1.state).toBe("synced");
    const r2 = await syncRepo(win, opts("win"));
    expect(r2.state).toBe("synced");
    const r3 = await syncRepo(mac, opts("mac")); // pull win's commit
    expect(r3.summary).toContain("↓1");
    // both files present on mac, history is linear (no merge commits)
    expect(readFileSync(join(mac, "projects/p/win-note.md"), "utf-8")).toBe("win\n");
    const merges = git(mac, "rev-list", "--merges", "--count", "HEAD").trim();
    expect(merges).toBe("0");
  }, 30_000);

  it("auto-merges append-only jsonl on both sides via union driver", async () => {
    appendFileSync(join(mac, "projects/p/time/mac.jsonl"), "mac1\n");
    appendFileSync(join(win, "projects/p/time/mac.jsonl"), "win1\n");
    await syncRepo(mac, opts("mac"));
    await syncRepo(win, opts("win")); // must not conflict
    const r = await syncRepo(win, opts("win"));
    expect(r.state).toBe("synced");
    const body = readFileSync(join(win, "projects/p/time/mac.jsonl"), "utf-8");
    expect(body).toContain("mac1");
    expect(body).toContain("win1");
  }, 30_000);

  it("on a real same-line conflict, aborts cleanly and reports conflict (no half-rebase)", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "MAC EDIT\n");
    writeFileSync(join(win, "projects/p/note.md"), "WIN EDIT\n");
    await syncRepo(mac, opts("mac"));
    const r = await syncRepo(win, opts("win"));
    expect(r.state).toBe("conflict");
    // repo not left mid-rebase: a normal status must succeed
    expect(() => git(win, "status")).not.toThrow();
    const status = git(win, "status", "--porcelain=v2", "--branch");
    expect(status).not.toContain("rebase");
  }, 30_000);

  it("reports offline when the remote is unreachable", async () => {
    git(mac, "remote", "set-url", "origin", join(root, "does-not-exist.git"));
    writeFileSync(join(mac, "projects/p/x.md"), "x\n");
    const r = await syncRepo(mac, opts("mac"));
    expect(r.state).toBe("offline");
  }, 30_000);

  it("times out a hung fetch (stalled ssh) and reports offline, leaving no orphan", async () => {
    // GIT_SSH_COMMAND that hangs forever simulates the stalled ssh from the incident
    const hang = join(root, "hang-ssh.sh");
    writeFileSync(hang, "#!/bin/sh\nsleep 300\n", { mode: 0o755 });
    git(mac, "remote", "set-url", "origin", "ssh://fake-host/repo.git");
    const prev = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = hang;
    try {
      const start = Date.now();
      const r = await syncRepo(mac, { ...opts("mac"), gitTimeoutMs: 1_000 });
      expect(r.state).toBe("offline");
      expect(Date.now() - start).toBeLessThan(10_000); // did not wait for sleep 300
      // no orphaned hang-ssh survives the process-group kill
      const ps = spawnSync("pgrep", ["-f", "hang-ssh.sh"], { encoding: "utf-8" });
      expect(ps.stdout.trim()).toBe("");
    } finally {
      if (prev === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = prev;
    }
  }, 30_000);

  it("reports offline (not conflict) when pull fails for network reasons", async () => {
    // fetch succeeds against the local remote; then we break the remote before pull
    writeFileSync(join(mac, "projects/p/new.md"), "x\n");
    // seed a remote commit so pull actually has to contact the remote
    writeFileSync(join(win, "projects/p/win2.md"), "w\n");
    await syncRepo(win, opts("win"));
    // now sabotage: point origin at a nonexistent path AFTER a manual fetch
    git(mac, "fetch", "--quiet");
    git(mac, "remote", "set-url", "origin", join(root, "gone.git"));
    const r = await syncRepo(mac, opts("mac"));
    expect(["offline"]).toContain(r.state);
    expect(r.detail).not.toMatch(/Rebase conflict/);
  }, 30_000);
});
