import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetGhFieldSupportForTests,
  createGitHubGhProvider,
  rollupChecks,
  type RunResult,
  type Runner,
} from "../github-gh.js";
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
  beforeEach(() => __resetGhFieldSupportForTests());

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
      headSha: "sha1",
      base: "main",
      updatedAt: "2026-11-21T10:05:00Z",
      url: "https://github.com/o/r/pull/231",
      forge: "github",
    });
    expect(prs[1]).toMatchObject({ isDraft: true, reviewers: [], reviewDecision: null, checks: "none" });
    expect(prs[2]).toMatchObject({ reviewers: ["dave"], reviewDecision: "changes", checks: "fail", base: "release" });
    expect(prs[3]).toMatchObject({ author: "app/dependabot", reviewDecision: "approved", checks: "pass" });

    const { run: emptyRun } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-empty.json")));
    expect(await createGitHubGhProvider({ run: emptyRun }).listOpen(REPO)).toEqual([]);
  });

  it("list entries carry headSha", async () => {
    const origin = originIs("git@github.com:o/r.git");
    const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-mixed.json")));
    const prs = await createGitHubGhProvider({ run }).listOpen(REPO);
    expect(prs.map((p) => p.headSha)).toEqual(["sha1", "sha2", "sha3", "sha4"]);
    const ghCall = calls.find((c) => c.cmd === "gh")!;
    expect(ghCall.args[ghCall.args.indexOf("--json") + 1].split(",")).toContain("headRefOid");
  });

  it("github rows carry forge github", async () => {
    const origin = originIs("git@github.com:o/r.git");
    const { run } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-mixed.json")));
    const prs = await createGitHubGhProvider({ run }).listOpen(REPO);
    expect(prs.length).toBeGreaterThan(0);
    expect(prs.every((p) => p.forge === "github")).toBe(true);
  });

  describe("getPr", () => {
    const view = (state: string) =>
      JSON.stringify({ ...(JSON.parse(fixture("gh-pr-list-mixed.json")) as object[])[0], state });

    it("getPr maps MERGED, CLOSED and OPEN to state", async () => {
      const origin = originIs("git@github.com:o/r.git");
      for (const [raw, state] of [
        ["MERGED", "merged"],
        ["CLOSED", "closed"],
        ["OPEN", "open"],
        ["SOMETHING_NEW", "open"],
      ]) {
        const { run } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(view(raw)));
        const pr = await createGitHubGhProvider({ run }).getPr(REPO, 231);
        expect(pr.state).toBe(state);
        expect(pr).toEqual({
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
          headSha: "sha1",
          base: "main",
          updatedAt: "2026-11-21T10:05:00Z",
          url: "https://github.com/o/r/pull/231",
          forge: "github",
          state,
        });
      }
    });

    it("getPr passes the PR fields plus state to gh pr view", async () => {
      const origin = originIs("git@github.com:o/r.git");
      const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(view("OPEN")));
      await createGitHubGhProvider({ run }).listOpen(REPO).catch(() => undefined);
      const listFields = calls.find((c) => c.cmd === "gh")!.args.at(-1)!;
      calls.length = 0;
      await createGitHubGhProvider({ run }).getPr(REPO, 231);
      const ghCall = calls.find((c) => c.cmd === "gh")!;
      expect(ghCall.cwd).toBe(REPO);
      expect(ghCall.args).toEqual(["pr", "view", "231", "--repo", "github.com/o/r", "--json", `${listFields},state`]);
    });
  });

  describe("older gh without headRefOid", () => {
    const UNKNOWN = { code: 1, stdout: "", stderr: 'Unknown JSON field: "headRefOid"\nAvailable fields:\n  additions\n' };
    const fieldsOf = (args: string[]) => args[args.indexOf("--json") + 1].split(",");
    const rows = () => (JSON.parse(fixture("gh-pr-list-mixed.json")) as Record<string, unknown>[]).map(({ headRefOid: _, ...r }) => r);
    const oldGh = (respond: (fields: string[]) => RunResult) => {
      const origin = originIs("git@github.com:o/r.git");
      return fakeRunner((cmd, args) => origin(cmd, args) ?? (fieldsOf(args).includes("headRefOid") ? UNKNOWN : respond(fieldsOf(args))));
    };

    it("list retries once without headRefOid, then skips it on the next call", async () => {
      const { run, calls } = oldGh(() => ok(JSON.stringify(rows())));
      const provider = createGitHubGhProvider({ run });
      const prs = await provider.listOpen(REPO);
      expect(prs.map((p) => p.headSha)).toEqual(["", "", "", ""]);
      expect(prs[0]).toMatchObject({ number: 231, head: "feat/search", checks: "running" });
      const ghCalls = calls.filter((c) => c.cmd === "gh");
      expect(ghCalls.map((c) => fieldsOf(c.args).includes("headRefOid"))).toEqual([true, false]);

      calls.length = 0;
      await createGitHubGhProvider({ run }).listOpen(REPO);
      expect(calls.filter((c) => c.cmd === "gh").map((c) => fieldsOf(c.args).includes("headRefOid"))).toEqual([false]);
    });

    it("view falls back to the last commit's oid", async () => {
      const { run, calls } = oldGh((fields) =>
        ok(
          JSON.stringify({
            ...rows()[0],
            state: "OPEN",
            ...(fields.includes("commits") ? { commits: [{ oid: "c1" }, { oid: "c2" }] } : {}),
          }),
        ),
      );
      const pr = await createGitHubGhProvider({ run }).getPr(REPO, 231);
      expect(pr).toMatchObject({ number: 231, state: "open", headSha: "c2" });
      const last = calls.filter((c) => c.cmd === "gh").at(-1)!;
      expect(fieldsOf(last.args)).toEqual(expect.arrayContaining(["state", "commits"]));
      expect(fieldsOf(last.args)).not.toContain("headRefOid");

      const { run: noCommits } = oldGh(() => ok(JSON.stringify({ ...rows()[0], state: "MERGED", commits: [] })));
      expect(await createGitHubGhProvider({ run: noCommits }).getPr(REPO, 231)).toMatchObject({ state: "merged", headSha: "" });
    });

    it("does not request commits when gh knows headRefOid", async () => {
      const origin = originIs("git@github.com:o/r.git");
      const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? ok(JSON.stringify({ ...rows()[0], headRefOid: "h", state: "OPEN" })));
      expect((await createGitHubGhProvider({ run }).getPr(REPO, 231)).headSha).toBe("h");
      expect(calls.filter((c) => c.cmd === "gh")).toHaveLength(1);
      expect(fieldsOf(calls.find((c) => c.cmd === "gh")!.args)).not.toContain("commits");
    });

    it("maps unrelated gh failures as before, without a retry or remembering anything", async () => {
      const origin = originIs("git@github.com:o/r.git");
      const fail = { code: 1, stdout: "", stderr: 'Unknown JSON field: "somethingElse"' };
      const { run, calls } = fakeRunner((cmd, args) => origin(cmd, args) ?? fail);
      const err = await createGitHubGhProvider({ run }).listOpen(REPO).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect((err as PrUnavailableError).reason).toBe("failed");
      expect(calls.filter((c) => c.cmd === "gh")).toHaveLength(1);

      const { run: auth } = fakeRunner((cmd, args) => origin(cmd, args) ?? { code: 4, stdout: "", stderr: "" });
      expect(((await createGitHubGhProvider({ run: auth }).getPr(REPO, 1).catch((e) => e)) as PrUnavailableError).reason).toBe(
        "gh-unauthenticated",
      );

      const { run: modern, calls: modernCalls } = fakeRunner(
        (cmd, args) => origin(cmd, args) ?? ok(fixture("gh-pr-list-mixed.json")),
      );
      await createGitHubGhProvider({ run: modern }).listOpen(REPO);
      expect(fieldsOf(modernCalls.find((c) => c.cmd === "gh")!.args)).toContain("headRefOid");
    });
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
      expect((err as PrUnavailableError).reason).toBe("unknown-forge");
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
      if (cmd === "gh") return ok(JSON.stringify({ baseRefName: "release", body: "## Why\nFixes it." }));
      if (args[0] === "fetch") return ok("");
      if (args.join(" ") === "rev-parse --is-shallow-repository") return ok("false\n");
      if (args[0] === "rev-parse" && args.some((a) => a.startsWith("refs/pavilio/pr/231"))) return ok("a".repeat(40) + "\n");
      if (args[0] === "rev-parse" && args.some((a) => a.startsWith("refs/pavilio/pr-base/231"))) return ok("b".repeat(40) + "\n");
      return new Error(`unexpected ${cmd} ${args.join(" ")}`);
    });

    const shas = await createGitHubGhProvider({ run }).openPr(REPO, 231);
    // The description rides along: the review shows it beside the diff.
    expect(shas).toEqual({ head: "a".repeat(40), base: "b".repeat(40), body: "## Why\nFixes it." });

    const fetch = calls.find((c) => c.cmd === "git" && c.args[0] === "fetch")!;
    expect(fetch.cwd).toBe(REPO);
    expect(fetch.args).toContain("origin");
    expect(fetch.args.some((a) => a.endsWith("pull/231/head:refs/pavilio/pr/231"))).toBe(true);
    // Both refs private: no remote-tracking update, no FETCH_HEAD, no submodule fetches.
    expect(fetch.args.some((a) => a.endsWith("refs/heads/release:refs/pavilio/pr-base/231"))).toBe(true);
    expect(fetch.args).toEqual(expect.arrayContaining(["--no-write-fetch-head", "--recurse-submodules=no", "--refmap="]));
    expect(fetch.args.some((a) => a.includes("refs/remotes/"))).toBe(false);
    // Pinned whole: the fetchPrRefs extraction must keep GitHub's argv byte for byte.
    expect(fetch.args).toEqual([
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--recurse-submodules=no",
      "--refmap=",
      "origin",
      "+pull/231/head:refs/pavilio/pr/231",
      "+refs/heads/release:refs/pavilio/pr-base/231",
    ]);
    // A credential prompt must never hang the request.
    expect(fetch.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(calls.filter((c) => c.cmd === "git").every((c) => c.env?.GIT_TERMINAL_PROMPT === "0")).toBe(true);

    const view = calls.find((c) => c.cmd === "gh" && c.args[1] === "view")!;
    expect(view.args.slice(0, 5)).toEqual(["pr", "view", "231", "--repo", "github.com/o/r"]);
  });

  describe("reviewComments", () => {
    const raw = (over: Record<string, unknown> = {}) => ({
      id: 1,
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      user: { login: "alice" },
      body: "nit",
      created_at: "2026-11-20T10:00:00Z",
      html_url: "https://github.com/o/r/pull/40#discussion_r1",
      commit_id: "headsha",
      ...over,
    });
    const lines = (...cs: object[]) => cs.map((c) => JSON.stringify(c)).join("\n") + (cs.length ? "\n" : "");
    const commentsRunner = (stdout: string, url = "git@github.com:o/r.git") => {
      const origin = originIs(url);
      return fakeRunner((cmd, args) => origin(cmd, args) ?? (cmd === "gh" ? ok(stdout) : new Error(`unexpected ${cmd}`)));
    };

    it("reviewComments maps gh api comments to ReviewComment", async () => {
      const { run, calls } = commentsRunner(
        lines(raw(), raw({ id: 2, in_reply_to_id: 1, side: "LEFT", line: 7, user: { login: "bob" }, body: "agreed" })),
      );
      const comments = await createGitHubGhProvider({ run }).reviewComments(REPO, 40);

      const gh = calls.find((c) => c.cmd === "gh")!;
      expect(gh.cwd).toBe(REPO);
      // Project only consumed fields: whole objects repeat `diff_hunk` and can overflow maxBuffer.
      expect(gh.args).toEqual([
        "api",
        "--hostname",
        "github.com",
        "--paginate",
        "repos/o/r/pulls/40/comments",
        "--jq",
        ".[] | {id, in_reply_to_id, path, line, side, user: {login: .user.login}, body, created_at, html_url, commit_id}",
      ]);
      expect(comments).toEqual([
        {
          id: 1,
          replyTo: null,
          path: "src/a.ts",
          line: 12,
          side: "new",
          author: "alice",
          body: "nit",
          createdAt: "2026-11-20T10:00:00Z",
          url: "https://github.com/o/r/pull/40#discussion_r1",
          commitId: "headsha",
        },
        expect.objectContaining({ id: 2, replyTo: 1, line: 7, side: "old", author: "bob", body: "agreed" }),
      ]);
    });

    it("reviewComments drops outdated comments", async () => {
      const { run } = commentsRunner(lines(raw({ id: 1, line: null }), raw({ id: 2 })));
      const comments = await createGitHubGhProvider({ run }).reviewComments(REPO, 40);
      expect(comments.map((c) => c.id)).toEqual([2]);
    });

    it("reviewComments concatenates paginated output", async () => {
      // --jq '.[]' emits one object per line on every page, so pages simply append.
      const page1 = lines(raw({ id: 1 }), raw({ id: 2 }));
      const page2 = lines(raw({ id: 3 }));
      const { run } = commentsRunner(page1 + page2);
      const comments = await createGitHubGhProvider({ run }).reviewComments(REPO, 40);
      expect(comments.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("reviewComments returns [] for a PR without comments", async () => {
      const { run } = commentsRunner("");
      expect(await createGitHubGhProvider({ run }).reviewComments(REPO, 40)).toEqual([]);
    });

    it("reviewComments rejects a line that is not JSON", async () => {
      const { run } = commentsRunner(lines(raw()) + "{not json\n");
      const err = await createGitHubGhProvider({ run }).reviewComments(REPO, 40).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect((err as PrUnavailableError).reason).toBe("failed");
    });

    it("reviewComments rejects a line that is JSON but not an object", async () => {
      for (const bad of ["null", "42", '"x"', "[]"]) {
        const { run } = commentsRunner(lines(raw()) + bad + "\n");
        const err = await createGitHubGhProvider({ run }).reviewComments(REPO, 40).catch((e) => e);
        expect(err).toBeInstanceOf(PrUnavailableError);
        expect((err as PrUnavailableError).reason).toBe("failed");
      }
    });

    it("openPr rejects an unsafe or invalid PR number before running anything", async () => {
      for (const n of [0, -1, 1.5, Number.NaN, 1e20]) {
        const { run, calls } = commentsRunner("");
        const err = await createGitHubGhProvider({ run }).openPr(REPO, n).catch((e) => e);
        expect(err).toBeInstanceOf(PrUnavailableError);
        expect((err as PrUnavailableError).reason).toBe("failed");
        expect(calls).toHaveLength(0);
      }
    });

    it("reviewComments rejects an invalid PR number and a non-GitHub remote", async () => {
      for (const n of [0, -1, 1.5, Number.NaN, 1e20]) {
        const { run, calls } = commentsRunner("");
        const err = await createGitHubGhProvider({ run }).reviewComments(REPO, n).catch((e) => e);
        expect(err).toBeInstanceOf(PrUnavailableError);
        expect((err as PrUnavailableError).reason).toBe("failed");
        expect(calls.some((c) => c.cmd === "gh")).toBe(false);
      }
      const { run, calls } = commentsRunner("", "git@gitlab.com:o/r.git");
      const err = await createGitHubGhProvider({ run }).reviewComments(REPO, 40).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect((err as PrUnavailableError).reason).toBe("unknown-forge");
      expect(calls.some((c) => c.cmd === "gh")).toBe(false);
    });
  });

  describe("openPr in a shallow clone", () => {
    const shallowRunner = (mergeBaseAfterDeepens: number) => {
      const origin = originIs("git@github.com:o/r.git");
      let deepens = 0;
      return fakeRunner((cmd, args) => {
        const o = origin(cmd, args);
        if (o) return o;
        if (cmd === "gh") return ok(JSON.stringify({ baseRefName: "release", body: "" }));
        if (args[0] === "fetch") {
          if (args.some((a) => a.startsWith("--deepen="))) deepens++;
          return ok("");
        }
        if (args.join(" ") === "rev-parse --is-shallow-repository") return ok("true\n");
        if (args[0] === "rev-parse") return ok((args.some((a) => a.includes("pr-base")) ? "b" : "a").repeat(40) + "\n");
        if (args[0] === "merge-base") return deepens >= mergeBaseAfterDeepens ? ok("c".repeat(40) + "\n") : { code: 1, stdout: "", stderr: "" };
        return new Error(`unexpected ${cmd} ${args.join(" ")}`);
      });
    };
    const deepenFetches = (calls: Call[]) => calls.filter((c) => c.args[0] === "fetch" && c.args.some((a) => a.startsWith("--deepen=")));

    it("deepens the PR fetch until base and head share a merge base", async () => {
      const { run, calls } = shallowRunner(2);
      expect(await createGitHubGhProvider({ run }).openPr(REPO, 231)).toEqual({ head: "a".repeat(40), base: "b".repeat(40), body: "" });
      const deepen = deepenFetches(calls);
      expect(deepen).toHaveLength(2);
      // Same private refspecs as the first fetch: still no remote-tracking update.
      expect(deepen[0].args.some((a) => a.endsWith("pull/231/head:refs/pavilio/pr/231"))).toBe(true);
      expect(deepen[0].args).toEqual(expect.arrayContaining(["--no-write-fetch-head", "--refmap="]));
    });

    it("does not deepen when the merge base is already here", async () => {
      const { run, calls } = shallowRunner(0);
      await createGitHubGhProvider({ run }).openPr(REPO, 231);
      expect(deepenFetches(calls)).toHaveLength(0);
    });

    it("stops deepening after a bounded number of rounds", async () => {
      const { run, calls } = shallowRunner(Infinity);
      expect(await createGitHubGhProvider({ run }).openPr(REPO, 231)).toEqual({ head: "a".repeat(40), base: "b".repeat(40), body: "" });
      expect(deepenFetches(calls).length).toBeGreaterThan(0);
      expect(deepenFetches(calls).length).toBeLessThanOrEqual(5);
    });
  });
});
