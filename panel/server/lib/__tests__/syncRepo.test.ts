import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Capture broadcasts so the tests can assert which realtime events a sync emits.
const sent = vi.hoisted(() => ({ messages: [] as { type: string }[] }));
vi.mock("../../watcher.js", () => ({
  broadcast: (m: { type: string }) => {
    sent.messages.push(m);
  },
}));

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
    // A tracked file outside the data paths (stands in for panel code / config).
    writeFileSync(join(seed, "tool.txt"), "tool v1\n");
    git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed"); git(seed, "push", "-q", "origin", "HEAD:main");
    mac = clone("mac"); win = clone("win");
  }, 30_000);
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const opts = (h: string) => ({ dataPaths: ["projects/"], hostname: h });

  it("disjoint edits converge through a merge", async () => {
    writeFileSync(join(mac, "projects/p/mac-note.md"), "mac\n");
    writeFileSync(join(win, "projects/p/win-note.md"), "win\n");
    const r1 = await syncRepo(mac, opts("mac"));
    expect(r1.state).toBe("synced");
    // win holds its own unpushed commit AND is behind → the tick must merge, not rebase
    const r2 = await syncRepo(win, opts("win"));
    expect(r2.state).toBe("synced");
    expect(r2.blockedFiles).toEqual([]);
    expect(readFileSync(join(win, "projects/p/mac-note.md"), "utf-8")).toBe("mac\n");
    expect(git(win, "rev-list", "--merges", "--count", "HEAD").trim()).toBe("1");
    // the merge reached the remote
    git(win, "fetch", "--quiet");
    expect(git(win, "rev-parse", "origin/main").trim()).toBe(git(win, "rev-parse", "HEAD").trim());
    const r3 = await syncRepo(mac, opts("mac")); // pull win's commit + merge
    expect(r3.state).toBe("synced");
    expect(readFileSync(join(mac, "projects/p/win-note.md"), "utf-8")).toBe("win\n");
  });

  it("an unpushed manual merge survives the next tick", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "MAC\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");
    // win resolves a same-line conflict by hand and has not pushed yet
    writeFileSync(join(win, "projects/p/note.md"), "WIN\n");
    git(win, "commit", "-qam", "win edit");
    try {
      git(win, "pull", "--no-rebase", "--no-edit");
    } catch {
      // expected: the merge stops on the conflict
    }
    writeFileSync(join(win, "projects/p/note.md"), "MAC+WIN\n");
    git(win, "add", "projects/p/note.md");
    git(win, "commit", "-q", "--no-edit");
    const manualMerge = git(win, "rev-parse", "HEAD").trim();
    // meanwhile the remote moves on
    writeFileSync(join(mac, "projects/p/later.md"), "later\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");

    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("synced");
    expect(readFileSync(join(win, "projects/p/note.md"), "utf-8")).toBe("MAC+WIN\n");
    expect(readFileSync(join(win, "projects/p/later.md"), "utf-8")).toBe("later\n");
    // the human's resolution is in the pushed history, not linearised away
    git(win, "fetch", "--quiet");
    expect(() => git(win, "merge-base", "--is-ancestor", manualMerge, "origin/main")).not.toThrow();
  });

  it("uncommitted non-data files block without stashing", async () => {
    // the remote changes a non-data file …
    writeFileSync(join(mac, "tool.txt"), "tool v2\n");
    git(mac, "commit", "-qam", "tool v2");
    git(mac, "push", "-q");
    // … that win has edited and not committed
    writeFileSync(join(win, "tool.txt"), "win local tool\n");
    const headBefore = git(win, "rev-parse", "HEAD").trim();
    const stashBefore = git(win, "stash", "list");

    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("blocked");
    expect(r.blockedFiles).toEqual(["tool.txt"]);
    expect(r.detail).toContain("tool.txt");
    expect(r.conflictFiles).toEqual([]);
    // nothing touched: local edit intact, HEAD unmoved, no merge in progress, no stash
    expect(readFileSync(join(win, "tool.txt"), "utf-8")).toBe("win local tool\n");
    expect(git(win, "rev-parse", "HEAD").trim()).toBe(headBefore);
    expect(existsSync(join(win, ".git/MERGE_HEAD"))).toBe(false);
    expect(git(win, "stash", "list")).toBe(stashBefore);
  });

  it("a same-line conflict aborts the merge and names the files", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    expect(r.blockedFiles).toEqual([]);
    expect(r.conflictPrompt).toContain("projects/p/note.md");
    expect(r.conflictPrompt).toContain("merge conflict");
    // the abort ran: no merge in progress, no conflict markers left behind
    expect(existsSync(join(win, ".git/MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(win, "projects/p/note.md"), "utf-8")).toBe("win edit\n");
    expect(() => git(win, "status")).not.toThrow();
  });

  it("merges a divergence even when pull.ff=only is configured", async () => {
    git(win, "config", "pull.ff", "only");
    writeFileSync(join(mac, "projects/p/mac-note.md"), "mac\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");
    writeFileSync(join(win, "projects/p/win-note.md"), "win\n");

    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("synced");
    expect(git(win, "rev-list", "--merges", "--count", "HEAD").trim()).toBe("1");
    expect(readFileSync(join(win, "projects/p/mac-note.md"), "utf-8")).toBe("mac\n");
  });

  it("a same-line conflict in a linked worktree aborts the merge and names the files", async () => {
    // .git is a file in a linked worktree, so <repo>/.git/MERGE_HEAD never exists.
    const base = clone("base");
    git(base, "checkout", "-q", "--detach");
    const wt = join(root, "wt");
    git(base, "worktree", "add", "-q", wt, "main");
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");
    writeFileSync(join(wt, "projects/p/note.md"), "wt edit\n");

    const r = await syncRepo(wt, opts("wt"));

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    // the abort ran: no merge in progress, no conflict markers left behind
    const mergeHead = spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: wt });
    expect(mergeHead.status).not.toBe(0);
    expect(readFileSync(join(wt, "projects/p/note.md"), "utf-8")).toBe("wt edit\n");
  });

  it("names a non-ASCII conflicting file unescaped", async () => {
    const name = "projects/p/zażółć.md";
    writeFileSync(join(mac, name), "mac\n");
    expect((await syncRepo(mac, opts("mac"))).state).toBe("synced");
    writeFileSync(join(win, name), "win\n");

    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual([name]);
    expect(r.conflictPrompt).toContain(name);
  });

  it("a repo already mid-merge is reported, not aborted", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    await syncRepo(mac, opts("mac"));
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");
    git(win, "commit", "-qam", "win edit");
    try {
      git(win, "pull", "--no-rebase", "--no-edit");
    } catch {
      // expected: the merge stops on the conflict
    }
    expect(existsSync(join(win, ".git/MERGE_HEAD"))).toBe(true);

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    expect(r.blockedFiles).toEqual([]);
    expect(r.conflictPrompt).toContain("already mid-merge");
    expect(r.conflictPrompt).toContain("merge --abort");
    // someone else's in-progress merge is left alone
    expect(existsSync(join(win, ".git/MERGE_HEAD"))).toBe(true);
    expect(readFileSync(join(win, "projects/p/note.md"), "utf-8")).toContain("<<<<<<<");
  });

  it("a rejected push is retried once after a merge", async () => {
    // win's commit is parked on the remote; the first push from mac moves main to it
    // and is rejected, exactly like a peer pushing between our pull and our push.
    writeFileSync(join(win, "projects/p/win-note.md"), "win\n");
    git(win, "add", "-A");
    git(win, "commit", "-qm", "win note");
    git(win, "push", "-q", "origin", "HEAD:refs/staged/win");
    const counter = join(root, "push-count");
    const hook = join(remote, "hooks/pre-receive");
    writeFileSync(
      hook,
      `#!/bin/sh\n` +
        `n=$(cat "${counter}" 2>/dev/null || echo 0)\n` +
        `echo $((n + 1)) > "${counter}"\n` +
        `if [ "$n" = 0 ]; then\n` +
        `  env -u GIT_QUARANTINE_PATH git update-ref refs/heads/main refs/staged/win\n` +
        `  exit 1\n` +
        `fi\n` +
        `exit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(mac, "projects/p/mac-note.md"), "mac\n");

    const r = await syncRepo(mac, opts("mac"));

    expect(r.state).toBe("synced");
    expect(readFileSync(counter, "utf-8").trim()).toBe("2");
    expect(readFileSync(join(mac, "projects/p/win-note.md"), "utf-8")).toBe("win\n");
    expect(git(mac, "rev-list", "--merges", "--count", "HEAD").trim()).toBe("1");
    git(mac, "fetch", "--quiet");
    expect(git(mac, "rev-parse", "origin/main").trim()).toBe(git(mac, "rev-parse", "HEAD").trim());

    // rejected twice → push-failed
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(mac, "projects/p/mac-note2.md"), "mac2\n");
    const r2 = await syncRepo(mac, opts("mac"));
    expect(r2.state).toBe("push-failed");
    expect(r2.blockedFiles).toEqual([]);
  });

  it("blockedFiles is cleared on any other outcome", async () => {
    writeFileSync(join(mac, "tool.txt"), "tool v2\n");
    git(mac, "commit", "-qam", "tool v2");
    git(mac, "push", "-q");
    writeFileSync(join(win, "tool.txt"), "win local tool\n");
    expect((await syncRepo(win, opts("win"))).blockedFiles).toEqual(["tool.txt"]);

    // offline clears it
    const url = git(win, "remote", "get-url", "origin").trim();
    git(win, "remote", "set-url", "origin", join(root, "does-not-exist.git"));
    const off = await syncRepo(win, opts("win"));
    expect(off.state).toBe("offline");
    expect(off.blockedFiles).toEqual([]);

    // blocked again, then the user discards the edit → synced clears it
    git(win, "remote", "set-url", "origin", url);
    expect((await syncRepo(win, opts("win"))).state).toBe("blocked");
    git(win, "checkout", "--", "tool.txt");
    const ok = await syncRepo(win, opts("win"));
    expect(ok.state).toBe("synced");
    expect(ok.blockedFiles).toEqual([]);
  });

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
  });

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
  });

  it("builds a conflict prompt classifying the conflicted path", async () => {
    writeFileSync(join(mac, "projects/p/note.md"), "mac edit\n");
    await syncRepo(mac, opts("mac"));
    writeFileSync(join(win, "projects/p/note.md"), "win edit\n");

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.conflictPrompt).toContain("Data files");
    expect(r.conflictPrompt).toContain("projects/p/note.md");
    expect(r.conflictPrompt).toContain(win);
    expect(r.conflictPrompt).toContain("branch main");
  });

  it("names the files and hands over a prompt when the repo is already mid-rebase", async () => {
    // A mid-rebase repo lives under .git/rebase-merge (merge backend, git ≥2.26
    // default) OR .git/rebase-apply (apply backend, the default on older git like
    // 2.25). Mirror syncRepo's own backend-agnostic check instead of assuming one.
    const midRebase = () =>
      existsSync(join(win, ".git/rebase-merge")) ||
      existsSync(join(win, ".git/rebase-apply"));

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
    expect(midRebase()).toBe(true);

    const r = await syncRepo(win, { ...opts("win"), generatedPaths: ["panel/"] });

    expect(r.state).toBe("conflict");
    expect(r.conflictFiles).toEqual(["projects/p/note.md"]);
    expect(r.conflictPrompt).toContain("projects/p/note.md");
    expect(r.conflictPrompt).toContain("already mid-rebase");
    expect(r.conflictPrompt).toContain("rebase --abort");
    // it must NOT abort someone else's in-progress rebase
    expect(midRebase()).toBe(true);
  });

  /**
   * Regression: a successful sync only broadcast sync-status, so open file lists kept
   * showing files it had just committed. Reported 2026-07-29 as "I clicked the sync
   * button and they are still there".
   */
  it("broadcasts git-change after committing, so open file lists refetch", async () => {
    writeFileSync(join(mac, "projects/p/new-note.md"), "mac\n");
    sent.messages.length = 0;

    const r = await syncRepo(mac, opts("mac"));

    expect(r.state).toBe("synced");
    expect(sent.messages.filter((m) => m.type === "git-change")).toHaveLength(1);
  });

  it("broadcasts git-change when a sync only pulls commits in", async () => {
    writeFileSync(join(mac, "projects/p/from-mac.md"), "mac\n");
    await syncRepo(mac, opts("mac"));
    sent.messages.length = 0;

    // win commits nothing of its own; it only receives mac's commit.
    const r = await syncRepo(win, opts("win"));

    expect(r.state).toBe("synced");
    expect(r.summary).toContain("↓1");
    expect(sent.messages.filter((m) => m.type === "git-change")).toHaveLength(1);
  });

  it("does not broadcast git-change on a no-op sync", async () => {
    // Nothing dirty, nothing ahead, nothing behind.
    const first = await syncRepo(mac, opts("mac"));
    expect(first.state).toBe("synced");
    sent.messages.length = 0;

    const r = await syncRepo(mac, opts("mac"));

    expect(r.state).toBe("synced");
    expect(r.summary).toBe("↑0 ↓0");
    expect(sent.messages.filter((m) => m.type === "git-change")).toHaveLength(0);
    // status still broadcast, so the UI keeps its lastSync fresh
    expect(sent.messages.filter((m) => m.type === "sync-status").length).toBeGreaterThan(0);
  });

  it("reports offline when the remote is unreachable", async () => {
    git(mac, "remote", "set-url", "origin", join(root, "does-not-exist.git"));
    writeFileSync(join(mac, "projects/p/x.md"), "x\n");
    const r = await syncRepo(mac, opts("mac"));
    expect(r.state).toBe("offline");
  });

  it("times out a hung fetch (stalled ssh) and reports offline, leaving no orphan", async () => {
    // GIT_SSH_COMMAND that hangs forever simulates the stalled ssh from the incident
    const hang = join(root, "hang-ssh.sh");
    writeFileSync(hang, "#!/bin/sh\nsleep 300\n", { mode: 0o755 });
    // Decoy: a foreign long-sleeping process whose command line also ends in
    // /hang-ssh.sh, but from a DIFFERENT directory — the neighbor worktree
    // running this suite concurrently. The orphan check below must match our
    // own script by its full per-test path and ignore this one.
    const decoyRoot = mkdtempSync(join(tmpdir(), "syncrepo-decoy-"));
    const decoyScript = join(decoyRoot, "hang-ssh.sh");
    writeFileSync(decoyScript, "#!/bin/sh\nsleep 300\n", { mode: 0o755 });
    // detached → own process group, so the cleanup kill reaps sh and its sleep
    const decoy = spawn(decoyScript, [], { detached: true, stdio: "ignore" });
    git(mac, "remote", "set-url", "origin", "ssh://fake-host/repo.git");
    const prev = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = hang;
    try {
      const start = Date.now();
      const r = await syncRepo(mac, { ...opts("mac"), gitTimeoutMs: 1_000 });
      expect(r.state).toBe("offline");
      expect(Date.now() - start).toBeLessThan(10_000); // did not wait for sleep 300
      // No orphaned hang-ssh survives the process-group kill. Match by the
      // full per-test path: a bare basename would also catch the decoy (or a
      // neighbor worktree's concurrent run) and fail spuriously.
      const ps = spawnSync("pgrep", ["-f", hang], { encoding: "utf-8" });
      expect(ps.stdout.trim()).toBe("");
      // The foreign process is none of this test's business: it must still
      // be running untouched.
      expect(decoy.exitCode).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = prev;
      // Never leak the decoy: kill its whole process group (sh + sleep).
      try {
        process.kill(-decoy.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      rmSync(decoyRoot, { recursive: true, force: true });
    }
  });

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
    expect(r.detail).not.toMatch(/conflict/i);
  });

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
  });

  it("isStale flags a lastSync older than 3x the interval", async () => {
    // fresh module state: never synced → not stale (now=0 predates any lastSync)
    expect(isStale(30, 0)).toBe(false);
    writeFileSync(join(mac, "projects/p/stale-probe.md"), "s\n");
    const r = await syncRepo(mac, opts("mac"));
    expect(r.state).toBe("synced");
    expect(isStale(30)).toBe(false); // just synced
    const in2h = Date.now() + 2 * 60 * 60_000;
    expect(isStale(30, in2h)).toBe(true); // 2h > 3 * 30min
  });
});
