import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncRepo, isStale } from "../syncRepo.js";

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
    // The seed pushes HEAD:main, so the remote's HEAD must point there —
    // otherwise clones are empty on machines whose default branch isn't
    // "main". symbolic-ref (unlike --initial-branch) works on old git too.
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
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

  it("captures the conflicted paths before aborting the rebase", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");

    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");
    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    // the abort still ran: nothing is half-applied
    expect(existsSync(join(win, ".git/rebase-merge"))).toBe(false);
    expect(existsSync(join(win, ".git/rebase-apply"))).toBe(false);
  }, 30_000);

  it("clears conflictFiles once a later sync succeeds", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    await syncRepo(mac, opts("mac"));
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");
    expect((await syncRepo(win, opts("win"))).conflictFiles).toHaveLength(1);

    // discard win's conflicting commit, then sync cleanly
    git(win, "reset", "--hard", "origin/main");
    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("synced");
    expect(r.conflictFiles).toEqual([]);
  }, 30_000);

  it("builds a conflict prompt classifying the conflicted path", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    await syncRepo(mac, opts("mac"));
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.conflictPrompt).toContain("Data files");
    expect(r.conflictPrompt).toContain("projects/p/note.md");
    expect(r.conflictPrompt).toContain(win);
    expect(r.conflictPrompt).toContain("branch main");
  }, 30_000);

  it("names the files and hands over a prompt when the repo is already mid-rebase", async () => {
    // Leave win genuinely mid-rebase, the way a crashed earlier tick would.
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    await syncRepo(mac, opts("mac"));
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");
    git(win, "add", "-A");
    git(win, "commit", "-qm", "win edit");
    git(win, "fetch", "--quiet");
    try {
      git(win, "pull", "--rebase");
    } catch {
      // expected: the rebase stops on the conflict
    }
    expect(existsSync(join(win, ".git/rebase-merge"))).toBe(true);

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    expect(r.conflictPrompt).toContain("projects/p/note.md");
    expect(r.conflictPrompt).toContain("already mid-rebase");
    expect(r.conflictPrompt).toContain("rebase --abort");
    // it must NOT abort someone else's in-progress rebase
    expect(existsSync(join(win, ".git/rebase-merge"))).toBe(true);
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

  it("watchdog: a stuck previous run does not block syncing forever", async () => {
    const hang = join(root, "hang-ssh2.sh");
    writeFileSync(hang, "#!/bin/sh\nsleep 300\n", { mode: 0o755 });
    const url = git(mac, "remote", "get-url", "origin").trim();
    git(mac, "remote", "set-url", "origin", "ssh://fake-host/repo.git");
    const prev = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = hang;
    // long gitTimeoutMs → this call stays "running" in the background
    const stuck = syncRepo(mac, { ...opts("mac"), gitTimeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 300)); // let it enter running state
    // restore a healthy remote for the second call
    git(mac, "remote", "set-url", "origin", url);
    if (prev === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = prev;
    // watchdogMs: 0 → previous run counts as stuck immediately
    const r = await syncRepo(mac, { ...opts("mac"), watchdogMs: 0 });
    expect(r.state).not.toBe("busy");
    await stuck; // let the stale (force-reset) run finish — its finally/setStatus must not clobber shared state
    // A third quick call must not be blocked by the stale run's finally resetting
    // `running` out from under the second run, and its status must reflect the
    // third call's own outcome (not a stale broadcast from the first run).
    writeFileSync(join(mac, "projects/p/third.md"), "third\n");
    const r3 = await syncRepo(mac, opts("mac"));
    expect(r3.state).not.toBe("busy");
    expect(r3.state).toBe("synced");
  }, 60_000);

  it("isStale flags a lastSync older than 3x the interval", async () => {
    // fresh module state: never synced → not stale (now=0 predates any lastSync)
    expect(isStale(30, 0)).toBe(false);
    writeFileSync(join(mac, "projects/p/stale-probe.md"), "s\n");
    const r = await syncRepo(mac, opts("mac"));
    expect(r.state).toBe("synced");
    expect(isStale(30)).toBe(false); // just synced
    const in2h = Date.now() + 2 * 60 * 60_000;
    expect(isStale(30, in2h)).toBe(true); // 2h > 3 * 30min
  }, 30_000);
});
