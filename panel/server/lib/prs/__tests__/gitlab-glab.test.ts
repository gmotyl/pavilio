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
}

function fakeRunner(respond: (cmd: string, args: string[]) => RunResult | Error): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
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
    expect(field(c.args, "-F", "path")).toBe(PROJECT);
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
    const pr = await listOne(mr({ reviewers: { nodes: [reviewer("alice", "UNREVIEWED"), reviewer("bob", "REVIEWED")] } }));
    expect(pr.reviewers).toEqual(["alice"]);
  });

  it("reviewDecision follows changes, approved, required, null order", async () => {
    const changes = { nodes: [reviewer("alice", "UNREVIEWED"), reviewer("bob", "REQUESTED_CHANGES")] };
    expect((await listOne(mr({ reviewers: changes, approved: true }))).reviewDecision).toBe("changes");
    expect((await listOne(mr({ approved: true, approvalsLeft: 1 }))).reviewDecision).toBe("approved");
    expect((await listOne(mr({ approvalsLeft: 2 }))).reviewDecision).toBe("required");
    const pending = { nodes: [reviewer("alice", "UNREVIEWED")] };
    expect((await listOne(mr({ reviewers: pending, approvalsLeft: 0 }))).reviewDecision).toBe("required");
    const reviewed = { nodes: [reviewer("bob", "REVIEWED")] };
    expect((await listOne(mr({ reviewers: reviewed, approvalsLeft: 0 }))).reviewDecision).toBeNull();
    expect((await listOne(mr({ approvalsLeft: null }))).reviewDecision).toBeNull();
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
      expect(field(c.args, "-F", "path")).toBe(PROJECT);
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
      expect(calls).toHaveLength(0);
    }
  });
});
