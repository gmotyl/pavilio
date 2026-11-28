import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createForgeResolver, remotePath } from "../forge.js";
import type { RunResult, Runner } from "../run.js";

const REPO = "/work/acme-web";

function originRunner(url: string | null): { run: Runner; calls: string[] } {
  const calls: string[] = [];
  const run: Runner = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(" ")}`);
    if (cmd === "git" && args.join(" ") === "remote get-url origin") {
      return url === null
        ? ({ code: 2, stdout: "", stderr: "error: No such remote 'origin'" } satisfies RunResult)
        : { code: 0, stdout: `${url}\n`, stderr: "" };
    }
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  return { run, calls };
}

const GLAB_CONFIG = `git_protocol: ssh
hosts:
  gitlab.com:
    token: abc
  git.cps.metro-markets.org:
    token: def
    api_protocol: https
`;

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "forge-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("createForgeResolver", () => {
  it("override wins over the origin host", async () => {
    const onGitlab = createForgeResolver({
      run: originRunner("git@git.cps.metro-markets.org:mm/platform/monorepo.git").run,
      readGlabConfig: () => GLAB_CONFIG,
    });
    expect(await onGitlab({ repoPath: REPO, forge: "github" })).toEqual({
      forge: "github",
      host: "git.cps.metro-markets.org",
      projectPath: "mm/platform/monorepo",
    });

    const onUnknown = createForgeResolver({
      run: originRunner("https://code.example.org/team/app.git").run,
      readGlabConfig: () => null,
    });
    expect(await onUnknown({ repoPath: REPO, forge: "gitlab" })).toEqual({
      forge: "gitlab",
      host: "code.example.org",
      projectPath: "team/app",
    });
  });

  it("github.com and ssh.github.com resolve to github", async () => {
    for (const [url, host] of [
      ["git@github.com:o/r.git", "github.com"],
      ["ssh://git@ssh.github.com:443/o/r.git", "ssh.github.com"],
    ]) {
      const resolve = createForgeResolver({ run: originRunner(url).run, readGlabConfig: () => null });
      expect(await resolve({ repoPath: REPO })).toEqual({ forge: "github", host, projectPath: "o/r" });
    }
  });

  it("gitlab.com resolves to gitlab", async () => {
    const resolve = createForgeResolver({ run: originRunner("https://gitlab.com/g/sub/r.git").run, readGlabConfig: () => null });
    expect(await resolve({ repoPath: REPO })).toEqual({ forge: "gitlab", host: "gitlab.com", projectPath: "g/sub/r" });
  });

  it("a host from glab config resolves to gitlab", async () => {
    const resolve = createForgeResolver({
      run: originRunner("git@git.cps.metro-markets.org:mm/platform/monorepo.git").run,
      readGlabConfig: () => GLAB_CONFIG,
    });
    expect(await resolve({ repoPath: REPO })).toEqual({
      forge: "gitlab",
      host: "git.cps.metro-markets.org",
      projectPath: "mm/platform/monorepo",
    });
  });

  it("GLAB_CONFIG_DIR picks the config file", async () => {
    const url = "git@git.cps.metro-markets.org:mm/platform/monorepo.git";
    const dir = tmp();
    writeFileSync(join(dir, "config.yml"), GLAB_CONFIG);
    const home = tmp();

    const viaDir = createForgeResolver({ run: originRunner(url).run, env: { GLAB_CONFIG_DIR: dir, HOME: home } });
    expect((await viaDir({ repoPath: REPO })).forge).toBe("gitlab");

    // Without GLAB_CONFIG_DIR the default path under HOME is used — empty here.
    const viaHomeEmpty = createForgeResolver({ run: originRunner(url).run, env: { HOME: home } });
    expect((await viaHomeEmpty({ repoPath: REPO })).forge).toBe("unknown");

    mkdirSync(join(home, ".config", "glab-cli"), { recursive: true });
    writeFileSync(join(home, ".config", "glab-cli", "config.yml"), GLAB_CONFIG);
    const viaHome = createForgeResolver({ run: originRunner(url).run, env: { HOME: home } });
    expect((await viaHome({ repoPath: REPO })).forge).toBe("gitlab");
  });

  it("missing or broken glab config falls back to gitlab.com only", async () => {
    const custom = "git@git.cps.metro-markets.org:mm/platform/monorepo.git";
    for (const cfg of [null, "hosts: [unclosed\n  : : :", "just a string", "hosts: 3"]) {
      const resolveCustom = createForgeResolver({ run: originRunner(custom).run, readGlabConfig: () => cfg });
      expect(await resolveCustom({ repoPath: REPO })).toEqual({ forge: "unknown", host: "git.cps.metro-markets.org" });
      const resolveCom = createForgeResolver({ run: originRunner("git@gitlab.com:g/r.git").run, readGlabConfig: () => cfg });
      expect((await resolveCom({ repoPath: REPO })).forge).toBe("gitlab");
    }
    // A config dir that does not exist reads as no config, not a throw.
    const resolveMissing = createForgeResolver({
      run: originRunner(custom).run,
      env: { GLAB_CONFIG_DIR: join(tmp(), "nope"), HOME: tmp() },
    });
    expect((await resolveMissing({ repoPath: REPO })).forge).toBe("unknown");
  });

  it("config is re-read on every resolution", async () => {
    let cfg: string | null = null;
    const resolve = createForgeResolver({
      run: originRunner("git@git.cps.metro-markets.org:mm/platform/monorepo.git").run,
      readGlabConfig: () => cfg,
    });
    expect((await resolve({ repoPath: REPO })).forge).toBe("unknown");
    cfg = GLAB_CONFIG;
    expect((await resolve({ repoPath: REPO })).forge).toBe("gitlab");
  });

  it("no origin resolves to unknown with empty host", async () => {
    const resolve = createForgeResolver({ run: originRunner(null).run, readGlabConfig: () => GLAB_CONFIG });
    expect(await resolve({ repoPath: REPO })).toEqual({ forge: "unknown", host: "" });
  });

  it("an override on an origin without a host resolves to unknown with empty host", async () => {
    // e.g. a file:// or host-less ssh origin: glab --hostname "" must never run.
    for (const url of ["ssh://:22/group/app.git", "file:///srv/repos/app.git"]) {
      const resolve = createForgeResolver({ run: originRunner(url).run, readGlabConfig: () => GLAB_CONFIG });
      for (const forge of ["gitlab", "github"] as const) {
        expect(await resolve({ repoPath: REPO, forge })).toEqual({ forge: "unknown", host: "" });
      }
    }
  });

  it("unknown host runs no forge CLI", async () => {
    const { run, calls } = originRunner("https://bitbucket.org/team/app.git");
    const resolve = createForgeResolver({ run, readGlabConfig: () => GLAB_CONFIG });
    expect(await resolve({ repoPath: REPO })).toEqual({ forge: "unknown", host: "bitbucket.org" });
    expect(calls).toEqual(["git remote get-url origin"]);
  });
});

describe("remotePath", () => {
  it("remotePath keeps nested groups for scp, ssh and https remotes", () => {
    for (const url of [
      "git@git.cps.metro-markets.org:mm/platform/monorepo.git",
      "ssh://git@git.cps.metro-markets.org:2222/mm/platform/monorepo.git",
      "https://git.cps.metro-markets.org/mm/platform/monorepo.git",
      "https://user@git.cps.metro-markets.org/mm/platform/monorepo",
    ]) {
      expect(remotePath(url)).toBe("mm/platform/monorepo");
    }
    expect(remotePath("git@github.com:o/r.git")).toBe("o/r");
    expect(remotePath("https://gitlab.com/")).toBeNull();
    expect(remotePath("not a remote")).toBeNull();
  });
});
