import { describe, expect, it } from "vitest";
import type { ResolvedForge } from "../forge.js";
import { createGitLabGlabProvider } from "../gitlab-glab.js";
import { PrUnavailableError } from "../provider.js";
import type { RunResult, Runner } from "../run.js";

const REPO = "/work/shop";
const HOST = "gitlab.example.com";
const PROJECT = "group/sub/shop";

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

function fakeRunner(respond: (cmd: string, args: string[]) => RunResult | Error): { run: Runner; calls: Call[] } {
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
const resolve = async (): Promise<ResolvedForge> => ({ forge: "gitlab", host: HOST, projectPath: PROJECT });

interface RawMr {
  iid: string;
  title: string;
  draft: boolean;
  author: { username: string } | null;
  reviewers: { nodes: { username: string; mergeRequestInteraction: { reviewState: string } | null }[] };
  approved: boolean;
  approvalsLeft: number | null;
  approvalsRequired: number | null;
  approvedBy: { nodes: { username: string }[] } | null;
  headPipeline: { status: string } | null;
  sourceBranch: string;
  targetBranch: string;
  diffHeadSha: string;
  updatedAt: string;
  webUrl: string;
  state?: string;
  description?: string | null;
}

function mr(over: Partial<RawMr> = {}): RawMr {
  return {
    iid: "244",
    title: "Checkout flow",
    draft: false,
    author: { username: "carol" },
    reviewers: { nodes: [] },
    approved: false,
    approvalsLeft: 0,
    approvalsRequired: 0,
    approvedBy: { nodes: [] },
    headPipeline: { status: "SUCCESS" },
    sourceBranch: "feat/checkout",
    targetBranch: "main",
    diffHeadSha: "c".repeat(40),
    updatedAt: "2026-11-27T10:00:00Z",
    webUrl: `https://${HOST}/${PROJECT}/-/merge_requests/244`,
    ...over,
  };
}

const reviewer = (username: string, reviewState: string) => ({ username, mergeRequestInteraction: { reviewState } });
const listOut = (nodes: RawMr[]) => ok(JSON.stringify({ data: { project: { mergeRequests: { nodes } } } }));
const oneOut = (m: RawMr) => ok(JSON.stringify({ data: { project: { mergeRequest: m } } }));

async function listOne(m: RawMr) {
  const { run } = fakeRunner(() => listOut([m]));
  return (await createGitLabGlabProvider({ run, resolve }).listOpen(REPO))[0];
}

/** Value of `flag key=value` in a glab argv. */
const field = (args: string[], flag: string, key: string): string | undefined => {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1].startsWith(`${key}=`)) return args[i + 1].slice(key.length + 1);
  }
  return undefined;
};

describe("GitLabGlabProvider", () => {
  it("listOpen makes one graphql call with hostname and project path", async () => {
    const { run, calls } = fakeRunner(() => listOut([mr()]));
    await createGitLabGlabProvider({ run, resolve }).listOpen(REPO);

    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.cmd).toBe("glab");
    expect(c.cwd).toBe(REPO);
    expect(c.args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", HOST]);
    expect(field(c.args, "-f", "path")).toBe(PROJECT);
    expect(field(c.args, "-F", "path")).toBeUndefined();
    const query = field(c.args, "-f", "query")!;
    expect(query).toMatch(/project\(fullPath: \$path\)/);
    expect(query).toMatch(/mergeRequests\(state: opened, first: 100, sort: UPDATED_DESC\)/);
    for (const f of [
      "iid",
      "title",
      "draft",
      "author { username }",
      "reviewers { nodes { username mergeRequestInteraction { reviewState } } }",
      "approved",
      "approvalsLeft",
      "approvalsRequired",
      "approvedBy { nodes { username } }",
      "headPipeline { status }",
      "sourceBranch",
      "targetBranch",
      "diffHeadSha",
      "updatedAt",
      "webUrl",
    ]) {
      expect(query).toContain(f);
    }
  });

  it("maps merge request fields to PullRequest", async () => {
    expect(await listOne(mr({ draft: true }))).toEqual({
      repo: "shop",
      repoPath: REPO,
      number: 244,
      title: "Checkout flow",
      author: "carol",
      isDraft: true,
      reviewers: [],
      reviewDecision: null,
      checks: "pass",
      head: "feat/checkout",
      headSha: "c".repeat(40),
      base: "main",
      updatedAt: "2026-11-27T10:00:00Z",
      url: `https://${HOST}/${PROJECT}/-/merge_requests/244`,
      forge: "gitlab",
    });
  });

  it("reviewers lists only unreviewed reviewers", async () => {
    const nodes = [
      reviewer("alice", "UNREVIEWED"),
      reviewer("bob", "REVIEWED"),
      reviewer("dave", "APPROVED"),
      reviewer("erin", "REQUESTED_CHANGES"),
    ];
    const pr = await listOne(mr({ reviewers: { nodes } }));
    expect(pr.reviewers).toEqual(["alice"]);
  });

  it("reviewDecision follows changes, approved, required, null order", async () => {
    const changes = { nodes: [reviewer("alice", "UNREVIEWED"), reviewer("bob", "REQUESTED_CHANGES")] };
    expect((await listOne(mr({ reviewers: changes, approved: true }))).reviewDecision).toBe("changes");
    const byCarol = { nodes: [{ username: "carol" }] };
    expect((await listOne(mr({ approved: true, approvalsLeft: 0, approvedBy: byCarol }))).reviewDecision).toBe("approved");
    expect((await listOne(mr({ approvalsLeft: 2 }))).reviewDecision).toBe("required");
    const pending = { nodes: [reviewer("alice", "UNREVIEWED")] };
    expect((await listOne(mr({ reviewers: pending, approvalsLeft: 0 }))).reviewDecision).toBe("required");
    const reviewed = { nodes: [reviewer("bob", "REVIEWED")] };
    expect((await listOne(mr({ reviewers: reviewed, approvalsLeft: 0 }))).reviewDecision).toBeNull();
    expect((await listOne(mr({ approvalsLeft: null }))).reviewDecision).toBeNull();
  });

  it("approved without rules or approvals is not approved", async () => {
    // GitLab reports approved: true on any MR that needs no approval.
    const noRules = { approved: true, approvalsLeft: 0, approvalsRequired: 0, approvedBy: { nodes: [] } };
    const pending = { nodes: [reviewer("alice", "UNREVIEWED")] };
    expect((await listOne(mr({ ...noRules, reviewers: pending }))).reviewDecision).toBe("required");
    expect((await listOne(mr(noRules))).reviewDecision).toBeNull();
    expect((await listOne(mr({ ...noRules, approvalsRequired: null, approvedBy: null }))).reviewDecision).toBeNull();
  });

  it("approved with a real approval or satisfied required rules is approved", async () => {
    const oneApproval = { approved: true, approvalsLeft: 0, approvalsRequired: 0, approvedBy: { nodes: [{ username: "bob" }] } };
    expect((await listOne(mr(oneApproval))).reviewDecision).toBe("approved");
    const rulesMet = { approved: true, approvalsLeft: 0, approvalsRequired: 2, approvedBy: { nodes: [{ username: "bob" }, { username: "dan" }] } };
    expect((await listOne(mr(rulesMet))).reviewDecision).toBe("approved");
  });

  it("pipeline status maps to checks and unknown is never green", async () => {
    const cases: [RawMr["headPipeline"], string][] = [
      [{ status: "SUCCESS" }, "pass"],
      [{ status: "SKIPPED" }, "pass"],
      [{ status: "FAILED" }, "fail"],
      [{ status: "CANCELED" }, "fail"],
      [{ status: "RUNNING" }, "running"],
      [{ status: "PENDING" }, "running"],
      [{ status: "MANUAL" }, "running"],
      [{ status: "SOMETHING_NEW" }, "running"],
      [null, "none"],
    ];
    for (const [headPipeline, checks] of cases) {
      expect((await listOne(mr({ headPipeline }))).checks, JSON.stringify(headPipeline)).toBe(checks);
    }
  });

  it("getPr maps opened, locked, merged and closed", async () => {
    const cases: [string, string][] = [
      ["opened", "open"],
      ["locked", "open"],
      ["merged", "merged"],
      ["closed", "closed"],
    ];
    for (const [raw, state] of cases) {
      const { run, calls } = fakeRunner(() => oneOut(mr({ state: raw, description: "Body" })));
      const pr = await createGitLabGlabProvider({ run, resolve }).getPr(REPO, 244);
      expect(pr.state).toBe(state);
      expect(pr.number).toBe(244);
      expect(pr.forge).toBe("gitlab");

      expect(calls).toHaveLength(1);
      const [c] = calls;
      expect(c.args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", HOST]);
      expect(field(c.args, "-f", "path")).toBe(PROJECT);
    expect(field(c.args, "-F", "path")).toBeUndefined();
      expect(field(c.args, "-f", "iid")).toBe("244");
      const query = field(c.args, "-f", "query")!;
      expect(query).toMatch(/mergeRequest\(iid: \$iid\)/);
      for (const f of ["state", "description", "targetBranch", "diffHeadSha", "headPipeline { status }"]) {
        expect(query).toContain(f);
      }
    }
  });

  it("getPr rejects an invalid number without running glab", async () => {
    for (const n of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const { run, calls } = fakeRunner(() => new Error("must not run"));
      const err = await createGitLabGlabProvider({ run, resolve }).getPr(REPO, n).catch((e) => e);
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect((err as PrUnavailableError).reason).toBe("failed");
      expect((err as PrUnavailableError).message).toMatch(/^invalid PR number/);
      expect(calls).toHaveLength(0);
    }
  });

  it("getPr of a missing merge request says PR, not MR", async () => {
    const noMr = ok(JSON.stringify({ data: { project: { mergeRequest: null } } }));
    const { run } = fakeRunner(() => noMr);
    const err = await createGitLabGlabProvider({ run, resolve }).getPr(REPO, 244).catch((e) => e);
    expect(err).toBeInstanceOf(PrUnavailableError);
    expect(err.message).toBe("PR !244 not found");
  });

  it("openPr without a target branch says PR, not MR", async () => {
    const { run } = fakeRunner(() => oneOut(mr({ targetBranch: " " })));
    const err = await createGitLabGlabProvider({ run, resolve }).openPr(REPO, 244).catch((e) => e);
    expect(err).toBeInstanceOf(PrUnavailableError);
    expect(err.message).toBe("PR !244 has no target branch");
  });

  it("openPr fetches the merge-request head and returns the description", async () => {
    const HEAD = "a".repeat(40);
    const BASE = "b".repeat(40);
    for (const [description, body] of [
      ["Fixes checkout", "Fixes checkout"],
      [null, ""],
    ] as const) {
      const { run, calls } = fakeRunner((cmd, args) => {
        if (cmd === "glab") return oneOut(mr({ state: "opened", targetBranch: "develop", description }));
        if (args[0] === "fetch") return ok("");
        if (args[0] === "rev-parse" && args[1] === "--verify") return ok(args[2].includes("pr-base") ? `${BASE}\n` : `${HEAD}\n`);
        if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") return ok("false\n");
        return new Error(`unexpected ${cmd} ${args.join(" ")}`);
      });
      const out = await createGitLabGlabProvider({ run, resolve }).openPr(REPO, 244);
      expect(out).toEqual({ head: HEAD, base: BASE, body });

      const glab = calls.filter((c) => c.cmd === "glab");
      expect(glab).toHaveLength(1);
      expect(glab[0].args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", HOST]);
      const query = field(glab[0].args, "-f", "query")!;
      expect(query).toContain("targetBranch");
      expect(query).toContain("description");
      expect(field(glab[0].args, "-f", "iid")).toBe("244");

      const fetch = calls.find((c) => c.cmd === "git" && c.args[0] === "fetch")!;
      expect(fetch.cwd).toBe(REPO);
      expect(fetch.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0" });
      expect(fetch.args).toEqual([
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--recurse-submodules=no",
        "--refmap=",
        "origin",
        "+refs/merge-requests/244/head:refs/pavilio/pr/244",
        "+refs/heads/develop:refs/pavilio/pr-base/244",
      ]);
    }
  });

  const note = (over: Record<string, unknown> = {}) => ({
    id: 1,
    type: "DiffNote",
    body: "Looks off",
    author: { username: "alice" },
    created_at: "2026-11-27T11:00:00Z",
    position: { new_path: "src/cart.ts", new_line: 12, old_line: null, head_sha: "c".repeat(40) },
    ...over,
  });
  const discussionsOut = (...pages: unknown[][]) => ok(pages.map((p) => JSON.stringify(p)).join(""));
  // A relative URL root: a link built from host + path would miss "/gitlab".
  const WEB = `https://${HOST}/gitlab/${PROJECT}/-/merge_requests/40`;
  const webUrlOut = ok(JSON.stringify({ data: { project: { mergeRequest: { webUrl: WEB } } } }));

  async function comments(out: RunResult) {
    const { run, calls } = fakeRunner((_cmd, args) => (args[1] === "graphql" ? webUrlOut : out));
    return { result: await createGitLabGlabProvider({ run, resolve }).reviewComments(REPO, 40), calls };
  }

  it("reviewComments fetches the MR web URL with one graphql call", async () => {
    const { calls } = await comments(discussionsOut([]));
    const gql = calls.filter((c) => c.args[1] === "graphql");
    expect(gql).toHaveLength(1);
    expect(gql[0].cmd).toBe("glab");
    expect(gql[0].cwd).toBe(REPO);
    expect(gql[0].args.slice(0, 4)).toEqual(["api", "graphql", "--hostname", HOST]);
    expect(field(gql[0].args, "-f", "path")).toBe(PROJECT);
    expect(field(gql[0].args, "-F", "path")).toBeUndefined();
    expect(field(gql[0].args, "-f", "iid")).toBe("40");
    expect(field(gql[0].args, "-F", "iid")).toBeUndefined();
    expect(field(gql[0].args, "-f", "query")).toMatch(/mergeRequest\(iid: \$iid\)\s*\{\s*webUrl\s*\}/);
  });

  it("reviewComments without an MR web URL is failed", async () => {
    const noMr = ok(JSON.stringify({ data: { project: { mergeRequest: null } } }));
    const { run } = fakeRunner((_cmd, args) => (args[1] === "graphql" ? noMr : discussionsOut([])));
    const err = await createGitLabGlabProvider({ run, resolve }).reviewComments(REPO, 40).catch((e) => e);
    expect(err).toBeInstanceOf(PrUnavailableError);
    expect(err.reason).toBe("failed");
    expect(err.message).toBe("PR !40 not found");
  });

  it("reviewComments requests paginated discussions with an encoded nested path", async () => {
    const { calls } = await comments(discussionsOut([]));
    const api = calls.filter((c) => c.args[1] !== "graphql");
    expect(api).toHaveLength(1);
    expect(api[0].cmd).toBe("glab");
    expect(api[0].cwd).toBe(REPO);
    expect(api[0].args).toEqual([
      "api",
      "--hostname",
      HOST,
      "--paginate",
      `projects/${encodeURIComponent(PROJECT)}/merge_requests/40/discussions`,
    ]);
    expect(api[0].args[4]).toContain("group%2Fsub%2Fshop");
  });

  it("diff notes map to review comments with sides and replies", async () => {
    const { result } = await comments(
      discussionsOut([
        {
          id: "d1",
          notes: [
            note({ id: 101 }),
            note({
              id: 102,
              body: "Agreed",
              author: { username: "bob" },
              created_at: "2026-11-27T12:00:00Z",
              position: { new_path: "src/cart.ts", new_line: null, old_line: 7, head_sha: "d".repeat(40) },
            }),
          ],
        },
      ]),
    );
    expect(result).toEqual([
      {
        id: 101,
        replyTo: null,
        path: "src/cart.ts",
        line: 12,
        side: "new",
        author: "alice",
        body: "Looks off",
        createdAt: "2026-11-27T11:00:00Z",
        url: `${WEB}#note_101`,
        commitId: "c".repeat(40),
      },
      {
        id: 102,
        replyTo: 101,
        path: "src/cart.ts",
        line: 7,
        side: "old",
        author: "bob",
        body: "Agreed",
        createdAt: "2026-11-27T12:00:00Z",
        url: `${WEB}#note_102`,
        commitId: "d".repeat(40),
      },
    ]);
  });

  it("non-diff and line-less notes are dropped", async () => {
    const { result } = await comments(
      discussionsOut([
        { id: "d1", notes: [note({ id: 201, type: "DiscussionNote", position: undefined })] },
        { id: "d2", notes: [note({ id: 202, type: null, position: undefined })] },
        {
          id: "d3",
          notes: [note({ id: 203, position: { new_path: "a.ts", new_line: null, old_line: null, head_sha: "e".repeat(40) } })],
        },
        { id: "d4", notes: [note({ id: 204, position: null })] },
        { id: "d5", notes: [note({ id: 205 })] },
      ]),
    );
    expect(result.map((c) => c.id)).toEqual([205]);
  });

  it("a context-line note with both lines set is on the new side", async () => {
    const { result } = await comments(
      discussionsOut([
        { id: "d1", notes: [note({ id: 401, position: { new_path: "a.ts", new_line: 15, old_line: 13, head_sha: "f".repeat(40) } })] },
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 401, side: "new", line: 15 });
  });

  it("escaped quotes before ][ inside a body do not split pages", async () => {
    const body = 'quote \\"][" and \\\\';
    const { result } = await comments(
      discussionsOut([{ id: "d1", notes: [note({ id: 501, body })] }], [{ id: "d2", notes: [note({ id: 502 })] }]),
    );
    expect(result.map((c) => c.id)).toEqual([501, 502]);
    expect(result[0].body).toBe(body);
  });

  it("a single escaped quote inside a body does not split pages", async () => {
    // Serialized as `x\"]`: a parser that ignores escapes closes the string early and mis-splits.
    const body = 'x"]';
    const { result } = await comments(
      discussionsOut([{ id: "d1", notes: [note({ id: 601, body })] }], [{ id: "d2", notes: [note({ id: 602 })] }]),
    );
    expect(result.map((c) => c.id)).toEqual([601, 602]);
    expect(result[0].body).toBe(body);
  });

  it("truncated discussions output is failed", async () => {
    const err = await comments(ok('[{"id":1')).catch((e) => e);
    expect(err).toBeInstanceOf(PrUnavailableError);
    expect(err.reason).toBe("failed");
  });

  it("paginated pages are all parsed", async () => {
    const { result } = await comments(
      discussionsOut(
        [{ id: "d1", notes: [note({ id: 301, body: "has ][ inside" })] }],
        [{ id: "d2", notes: [note({ id: 302 })] }],
        [{ id: "d3", notes: [note({ id: 303 })] }],
      ),
    );
    expect(result.map((c) => c.id)).toEqual([301, 302, 303]);
    expect(result[0].body).toBe("has ][ inside");
  });

  const enoent = () => Object.assign(new Error("spawn glab ENOENT"), { code: "ENOENT" });
  const fail = (stderr: string, code = 1): RunResult => ({ code, stdout: "", stderr });

  /** Runs every entry point against one glab response; returns the errors. */
  async function allErrors(respond: (cmd: string, args: string[]) => RunResult | Error) {
    const { run } = fakeRunner(respond);
    const p = createGitLabGlabProvider({ run, resolve });
    const calls = [p.listOpen(REPO), p.getPr(REPO, 1), p.openPr(REPO, 1), p.reviewComments(REPO, 1)];
    return (await Promise.all(calls.map((c) => c.then(() => null, (e) => e)))) as PrUnavailableError[];
  }

  it("missing glab is glab-missing", async () => {
    for (const err of await allErrors(() => enoent())) {
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect(err.reason).toBe("glab-missing");
    }
  });

  it("auth failure is glab-unauthenticated with host", async () => {
    for (const stderr of [
      "glab: 401 Unauthorized",
      "glab: Unauthorized (HTTP 401)",
      "To authenticate, run: glab auth login",
      "error: not authenticated with gitlab.example.com",
    ]) {
      for (const err of await allErrors(() => fail(stderr))) {
        expect(err, stderr).toBeInstanceOf(PrUnavailableError);
        expect(err.reason, stderr).toBe("glab-unauthenticated");
        expect(err.host).toBe(HOST);
      }
    }
  });

  it("invalid json and graphql errors are failed", async () => {
    for (const err of await allErrors(() => ok("not json {"))) {
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect(err.reason).toBe("failed");
    }
    const errored = ok(JSON.stringify({ data: null, errors: [{ message: "Field 'nope' doesn't exist" }] }));
    for (const err of await allErrors(() => errored)) {
      expect(err).toBeInstanceOf(PrUnavailableError);
      expect(err.reason).toBe("failed");
    }
    // A 401 that is not an HTTP status (an id in a path) is not an auth failure.
    for (const err of await allErrors(() => fail("404 Not Found: merge_requests/401/discussions"))) {
      expect(err.reason).toBe("failed");
    }
    // Non-auth exit is failed too.
    for (const err of await allErrors(() => fail("500 Internal Server Error"))) {
      expect(err.reason).toBe("failed");
    }
    // An empty errors array is not a failure.
    const { run } = fakeRunner(() =>
      ok(JSON.stringify({ data: { project: { mergeRequests: { nodes: [mr()] } } }, errors: [] })),
    );
    expect(await createGitLabGlabProvider({ run, resolve }).listOpen(REPO)).toHaveLength(1);
  });

  it("credentials in errors are redacted", async () => {
    const stderr = "fatal: could not read from https://user:token@gitlab.example.com/group/sub/shop.git";
    for (const err of await allErrors(() => fail(stderr))) {
      expect(err.message).not.toContain("user:token");
      expect(err.message).toContain("https://***@gitlab.example.com");
    }
    // git failures in openPr too.
    const { run } = fakeRunner((cmd) => (cmd === "glab" ? oneOut(mr({ description: "" })) : fail(stderr, 128)));
    const err = await createGitLabGlabProvider({ run, resolve }).openPr(REPO, 244).catch((e) => e);
    expect(err).toBeInstanceOf(PrUnavailableError);
    expect(err.message).not.toContain("user:token");
    expect(err.message).toContain("https://***@gitlab.example.com");
  });
});
