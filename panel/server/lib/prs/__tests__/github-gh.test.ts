import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitHubGhProvider, rollupChecks, type RunResult, type Runner } from "../github-gh.js";
import { PrUnavailableError } from "../provider.js";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf-8");
const REPO = "/work/acme-web";

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

type Responder = (cmd: string, args: string[]) => RunResult | Error;

function fakeRunner(respond: Responder): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    const r = respond(cmd, args);
    if (r instanceof Error) throw r;
    return r;
  };
  return { run, calls };
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const originIs = (url: string) => (cmd: string, args: string[]) =>
  cmd === "git" && args.join(" ") === "remote get-url origin" ? ok(`${url}\n`) : null;

describe("GitHubGhProvider", () => {
  it("maps a mixed gh pr list into PullRequest rows", async () => {
    const origin = originIs("git@github.com:o/r.git");
    const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-mixed.json")));
    const prs = await createGitHubGhProvider({ run }).listOpen(REPO);

    const ghCall = calls.find((c) => c.cmd === "gh")!;
    expect(ghCall.cwd).toBe(REPO);
    // --repo pins gh to origin: in a fork clone gh would otherwise default to upstream.
    // github.com/ qualifies it: an unqualified slug would resolve against GH_HOST.
    expect(ghCall.args.slice(0, 8)).toEqual(["pr", "list", "--repo", "github.com/o/r", "--state", "open", "--limit", "100"]);

    expect(prs).toHaveLength(4);
    expect(prs[0]).toEqual({
      repo: "acme-web",
      repoPath: REPO,
      number: 231,
      title: "Add search",
      author: "alice",
      isDraft: false,
      reviewers: ["gmotyl"],
      reviewDecision: "required",
      checks: "running",
      head: "feat/search",
      base: "main",
      updatedAt: "2026-11-21T10:05:00Z",
      url: "https://github.com/o/r/pull/231",
    });
    expect(prs[1]).toMatchObject({ isDraft: true, reviewers: [], reviewDecision: null, checks: "none" });
    expect(prs[2]).toMatchObject({ reviewers: ["dave"], reviewDecision: "changes", checks: "fail", base: "release" });
    expect(prs[3]).toMatchObject({ author: "app/dependabot", reviewDecision: "approved", checks: "pass" });

    const { run: emptyRun } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-empty.json")));
    expect(await createGitHubGhProvider({ run: emptyRun }).listOpen(REPO)).toEqual([]);
  });

  it("rolls up status checks into pass/fail/running/none", () => {
    const run = (status: string, conclusion: string) => ({ __typename: "CheckRun", status, conclusion });
    const ctx = (state: string) => ({ __typename: "StatusContext", state });

    expect(rollupChecks([])).toBe("none");
    expect(rollupChecks(null)).toBe("none");
    expect(rollupChecks([run("COMPLETED", "SUCCESS"), ctx("SUCCESS"), run("COMPLETED", "SKIPPED")])).toBe("pass");
    expect(rollupChecks([run("COMPLETED", "SUCCESS"), run("QUEUED", "")])).toBe("running");
    expect(rollupChecks([ctx("PENDING"), run("COMPLETED", "SUCCESS")])).toBe("running");
    // A failure outranks anything still pending.
    expect(rollupChecks([run("IN_PROGRESS", ""), run("COMPLETED", "FAILURE")])).toBe("fail");
    expect(rollupChecks([ctx("ERROR"), ctx("PENDING")])).toBe("fail");
    expect(rollupChecks([run("COMPLETED", "TIMED_OUT")])).toBe("fail");
    expect(rollupChecks([run("COMPLETED", "CANCELLED")])).toBe("fail");
    expect(rollupChecks([run("COMPLETED", "ACTION_REQUIRED")])).toBe("fail");
    expect(rollupChecks([run("COMPLETED", "NEUTRAL")])).toBe("pass");
    expect(rollupChecks([run("COMPLETED", "SKIPPED")])).toBe("pass");
    // Only explicit successes pass; a stale or unknown conclusion is not green.
    expect(rollupChecks([run("COMPLETED", "SUCCESS"), run("COMPLETED", "STALE")])).toBe("running");
    expect(rollupChecks([run("COMPLETED", "WHATEVER")])).toBe("running");
    expect(rollupChecks([ctx("UNKNOWN")])).toBe("running");
  });

  it("rejects a non-GitHub origin without calling gh", async () => {
    for (const url of [
      "git@gitlab.com:o/r.git",
      "https://gitlab.example.com/o/r.git",
      "ssh://git@bitbucket.org/o/r.git",
      "https://github.com.evil.io/o/r.git",
    ]) {
      const origin = originIs(url);
      const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok("[]"));
      const err = await createGitHubGhProvider({ run }).listOpen(REPO).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect((err as PrUnavailableError).reason).toBe("not-github");
      expect(calls.some((c) => c.cmd === "gh")).toBe(false);
    }

    for (const url of [
      "https://github.com/o/r.git",
      "ssh://git@github.com/o/r.git",
      "git@github.com:o/r.git",
      "https://user@github.com/o/r",
      "ssh://git@ssh.github.com:443/o/r.git",
    ]) {
      const origin = originIs(url);
      const { run } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok("[]"));
      await expect(createGitHubGhProvider({ run }).listOpen(REPO)).resolves.toEqual([]);
    }
  });

  it("classifies a missing gh, an unauthenticated gh and other failures", async () => {
    const origin = originIs("https://github.com/o/r.git");
    const reasonFor = async (gh: RunResult | Error) => {
      const { run } = fakeRunner((cmd, args) => origin(cmd, args) ?? gh);
      const err = await createGitHubGhProvider({ run }).listOpen(REPO).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      return (err as PrUnavailableError).reason;
    };
    const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });

    expect(await reasonFor(enoent)).toBe("gh-missing");
    expect(await reasonFor({ code: 4, stdout: "", stderr: "" })).toBe("gh-unauthenticated");
    expect(
      await reasonFor({ code: 1, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" }),
    ).toBe("gh-unauthenticated");
    expect(await reasonFor({ code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository" })).toBe(
      "failed",
    );
    expect(await reasonFor(ok("not json"))).toBe("failed");
  });

  it("caches the gh login", async () => {
    const { run, calls } = fakeRunner(() => ok("gmotyl\n"));
    const provider = createGitHubGhProvider({ run });
    expect(await provider.whoami()).toBe("gmotyl");
    expect(await provider.whoami()).toBe("gmotyl");
    const apiCalls = calls.filter((c) => c.cmd === "gh" && c.args[0] === "api" && c.args[1] === "user");
    expect(apiCalls).toHaveLength(1);
  });

  it("asks github.com for the login and re-reads it after a while (gh auth switch)", async () => {
    let t = 0;
    let user = "first";
    const { run, calls } = fakeRunner(() => ok(`${user}\n`));
    const provider = createGitHubGhProvider({ run, now: () => t });
    expect(await provider.whoami()).toBe("first");
    expect(calls[0].args).toEqual(["api", "user", "--hostname", "github.com", "--jq", ".login"]);
    user = "second";
    t += 60_000;
    expect(await provider.whoami()).toBe("first");
    t += 10 * 60_000;
    expect(await provider.whoami()).toBe("second");
  });

  it("does not cache a failed gh login", async () => {
    let attempt = 0;
    const { run } = fakeRunner(() => (++attempt === 1 ? { code: 4, stdout: "", stderr: "" } : ok("gmotyl\n")));
    const provider = createGitHubGhProvider({ run });
    await expect(provider.whoami()).rejects.toBeInstanceOf(PrUnavailableError);
    expect(await provider.whoami()).toBe("gmotyl");
  });

  it("derives owner/repo from origin and passes it to gh", async () => {
    for (const [url, slug] of [
      ["git@github.com:me/fork.git", "me/fork"],
      ["https://github.com/me/fork", "me/fork"],
      ["https://user@github.com/me/fork.git/", "me/fork"],
      ["ssh://git@github.com/me/fork.git", "me/fork"],
    ]) {
      const origin = originIs(url);
      const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok("[]"));
      await createGitHubGhProvider({ run }).listOpen(REPO);
      const gh = calls.find((c) => c.cmd === "gh")!;
      expect(gh.args[gh.args.indexOf("--repo") + 1]).toBe(`github.com/${slug}`);
    }
  });

  it("openPr fetches the PR head into refs/pavilio/pr/<n>", async () => {
    const origin = originIs("git@github.com:o/r.git");
    const { run, calls } = fakeRunner((cmd, args) => {
      const o = origin(cmd, args);
      if (o) return o;
      if (cmd === "gh") return ok("release\n");
      if (args[0] === "fetch") return ok("");
      if (args[0] === "rev-parse" && args.some((a) => a.startsWith("refs/pavilio/pr/231"))) return ok("a".repeat(40) + "\n");
      if (args[0] === "rev-parse" && args.some((a) => a.startsWith("refs/pavilio/pr-base/231"))) return ok("b".repeat(40) + "\n");
      return new Error(`unexpected ${cmd} ${args.join(" ")}`);
    });

    const shas = await createGitHubGhProvider({ run }).openPr(REPO, 231);
    expect(shas).toEqual({ head: "a".repeat(40), base: "b".repeat(40) });

    const fetch = calls.find((c) => c.cmd === "git" && c.args[0] === "fetch")!;
    expect(fetch.cwd).toBe(REPO);
    expect(fetch.args).toContain("origin");
    expect(fetch.args.some((a) => a.endsWith("pull/231/head:refs/pavilio/pr/231"))).toBe(true);
    // Both refs private: no remote-tracking update, no FETCH_HEAD, no submodule fetches.
    expect(fetch.args.some((a) => a.endsWith("refs/heads/release:refs/pavilio/pr-base/231"))).toBe(true);
    expect(fetch.args).toEqual(expect.arrayContaining(["--no-write-fetch-head", "--recurse-submodules=no", "--refmap="]));
    expect(fetch.args.some((a) => a.includes("refs/remotes/"))).toBe(false);
    // A credential prompt must never hang the request.
    expect(fetch.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(calls.filter((c) => c.cmd === "git").every((c) => c.env?.GIT_TERMINAL_PROMPT === "0")).toBe(true);

    const view = calls.find((c) => c.cmd === "gh" && c.args[1] === "view")!;
    expect(view.args.slice(0, 5)).toEqual(["pr", "view", "231", "--repo", "github.com/o/r"]);
  });
});
