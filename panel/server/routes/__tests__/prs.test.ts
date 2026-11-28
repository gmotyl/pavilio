import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";
import { createForgeResolver, type ResolvedForge } from "../../lib/prs/forge";
import {
  type Forge,
  PrUnavailableError,
  type PrProvider,
  type PullRequest,
  type ReviewComment,
} from "../../lib/prs/provider";

const projects = withProjectsDir("prs-route-");
vi.mock("../../config", () => configMock(() => projects.dir()));

import { createPrsRouter, gitlabResolveFor } from "../prs";

function pr(repoPath: string, number: number, updatedAt: string): PullRequest {
  return {
    repo: repoPath.split("/").pop() ?? "",
    repoPath,
    number,
    title: `PR ${number}`,
    author: "someone",
    isDraft: false,
    reviewers: [],
    reviewDecision: null,
    checks: "none",
    head: "feat",
    headSha: "abc123",
    base: "main",
    updatedAt,
    url: `https://github.com/o/r/pull/${number}`,
    forge: "github",
  };
}

/** A project linking a GitHub repo, a non-GitHub repo and a repo missing on this machine. */
function setup() {
  const root = projects.root();
  const gh = join(root, "gh-repo");
  const gl = join(root, "gl-repo");
  const missing = join(root, "missing-repo");
  mkdirSync(gh);
  mkdirSync(gl);
  const dir = join(projects.dir(), "proj");
  mkdirSync(dir);
  writeFileSync(join(dir, "PROJECT.md"), "# proj\n");
  writeFileSync(
    join(dir, "repos.json"),
    JSON.stringify([
      { name: "GitHub Repo", path: gh },
      { name: "gl-repo", path: gl },
      { name: "missing-repo", path: missing },
    ]),
  );
  const provider = {
    whoami: vi.fn(async () => "me"),
    listOpen: vi.fn(async (p: string) => {
      if (p === gh) return [pr(gh, 1, "2026-11-20T00:00:00Z"), pr(gh, 2, "2026-11-21T00:00:00Z")];
      throw new PrUnavailableError("unknown-forge");
    }),
    openPr: vi.fn(async () => ({ head: "h", base: "b", body: "" })),
    reviewComments: vi.fn(async (): Promise<ReviewComment[]> => []),
    getPr: vi.fn(async (p: string, n: number) => ({ ...pr(p, n, "2026-11-22T00:00:00Z"), state: "merged" as const })),
  } satisfies PrProvider;
  return { gh, gl, missing, provider };
}

// GitHub-only tests: every present repo resolves to GitHub; the provider itself rejects gl-repo.
const githubOnly = async (): Promise<ResolvedForge> => ({ forge: "github", host: "github.com", projectPath: "o/r" });

const appFor = (provider: PrProvider, now?: () => number) =>
  makeApp(
    createPrsRouter({ github: provider, gitlab: provider }, { resolveForge: githubOnly, ...(now ? { now } : {}) }),
    "/api/prs",
  );

function fakeProvider(name: string, prs: (p: string) => PullRequest[]) {
  return {
    whoami: vi.fn(async () => `${name}-me`),
    listOpen: vi.fn(async (p: string) => prs(p)),
    openPr: vi.fn(async () => ({ head: `${name}-h`, base: `${name}-b`, body: name })),
    reviewComments: vi.fn(async (): Promise<ReviewComment[]> => []),
    getPr: vi.fn(async (p: string, n: number) => ({ ...pr(p, n, "2026-11-22T00:00:00Z"), state: "open" as const })),
  } satisfies PrProvider;
}

/** A project linking a GitHub repo, a GitLab repo, an unknown-forge repo and a missing repo. */
function setupMixed() {
  const root = projects.root();
  const gh = join(root, "mx-gh");
  const gl = join(root, "mx-gl");
  const unk = join(root, "mx-unknown");
  const missing = join(root, "mx-missing");
  for (const d of [gh, gl, unk]) mkdirSync(d);
  const dir = join(projects.dir(), "mix");
  mkdirSync(dir);
  writeFileSync(join(dir, "PROJECT.md"), "# mix\n");
  writeFileSync(
    join(dir, "repos.json"),
    JSON.stringify([
      { name: "hub", path: gh },
      { name: "lab", path: gl, forge: "gitlab" },
      { name: "odd", path: unk },
      { name: "gone", path: missing },
    ]),
  );
  const github = fakeProvider("github", (p) => [pr(p, 1, "2026-11-20T00:00:00Z"), pr(p, 3, "2026-11-23T00:00:00Z")]);
  const gitlab = fakeProvider("gitlab", (p) => [{ ...pr(p, 2, "2026-11-21T00:00:00Z"), forge: "gitlab" as const }]);
  const resolveForge = vi.fn(async (e: { repoPath: string; forge?: Forge }): Promise<ResolvedForge> => {
    if (e.repoPath === gh) return { forge: "github", host: "github.com", projectPath: "o/hub" };
    if (e.repoPath === gl) return { forge: e.forge ?? "gitlab", host: "git.example.com", projectPath: "g/lab" };
    return { forge: "unknown", host: "code.example.org" };
  });
  const app = makeApp(createPrsRouter({ github, gitlab }, { resolveForge }), "/api/prs");
  return { gh, gl, unk, missing, github, gitlab, resolveForge, app };
}

describe("/api/prs", () => {
  it("aggregates PRs across present GitHub repos", async () => {
    const { gh, provider } = setup();
    const res = await request(appFor(provider)).get("/api/prs?project=proj");
    expect(res.status).toBe(200);
    expect(res.body.me).toBe("me");
    expect(res.body.prs.map((p: PullRequest) => [p.repoPath, p.number])).toEqual([
      [gh, 2],
      [gh, 1],
    ]);
  });

  it("labels PR rows with the linked repo name, not the directory name", async () => {
    const { provider } = setup();
    const res = await request(appFor(provider)).get("/api/prs?project=proj");
    expect(res.body.prs.map((p: PullRequest) => p.repo)).toEqual(["GitHub Repo", "GitHub Repo"]);
  });

  it("calls the provider once for concurrent cold requests", async () => {
    const { gh, provider } = setup();
    const list = provider.listOpen.getMockImplementation()!;
    provider.listOpen.mockImplementation(async (p: string) => {
      await new Promise((r) => setTimeout(r, 50));
      return list(p);
    });
    const app = appFor(provider);
    const [a, b] = await Promise.all([
      request(app).get("/api/prs?project=proj"),
      request(app).get("/api/prs?project=proj"),
    ]);
    expect(a.body.prs).toHaveLength(2);
    expect(b.body.prs).toHaveLength(2);
    expect(provider.listOpen.mock.calls.filter((c) => c[0] === gh)).toHaveLength(1);
  });

  it("reports unavailable repos with their reason", async () => {
    const { provider } = setup();
    const res = await request(appFor(provider)).get("/api/prs?project=proj");
    expect(res.body.unavailable).toEqual([{ repo: "gl-repo", reason: "unknown-forge" }]);
  });

  it("reports a non-provider failure as failed and an unknown login as empty", async () => {
    const { gl, provider } = setup();
    provider.whoami.mockRejectedValue(new PrUnavailableError("gh-unauthenticated"));
    provider.listOpen.mockImplementation(async (p: string) => {
      if (p === gl) throw new Error("boom");
      return [];
    });
    const res = await request(appFor(provider)).get("/api/prs?project=proj");
    expect(res.status).toBe(200);
    expect(res.body.me).toBe("");
    expect(res.body.unavailable).toEqual([{ repo: "gl-repo", reason: "failed" }]);
  });

  it("never touches a missing linked repo", async () => {
    const { missing, provider } = setup();
    await request(appFor(provider)).get("/api/prs?project=proj");
    expect(provider.listOpen).toHaveBeenCalledTimes(2);
    expect(provider.listOpen.mock.calls.map((c) => c[0])).not.toContain(missing);
  });

  it("caches each repo's list for 60 seconds", async () => {
    const { gh, provider } = setup();
    let t = 1_000_000;
    const app = appFor(provider, () => t);
    await request(app).get("/api/prs?project=proj");
    t += 59_000;
    const second = await request(app).get("/api/prs?project=proj");
    expect(second.body.prs).toHaveLength(2);
    expect(provider.listOpen.mock.calls.filter((c) => c[0] === gh)).toHaveLength(1);
    t += 2_000;
    await request(app).get("/api/prs?project=proj");
    expect(provider.listOpen.mock.calls.filter((c) => c[0] === gh)).toHaveLength(2);
  });

  it("answers 404 for an unknown project", async () => {
    const { provider } = setup();
    const res = await request(appFor(provider)).get("/api/prs?project=nope");
    expect(res.status).toBe(404);
  });

  it("rejects opening a PR in an unlinked repo", async () => {
    const { missing, provider } = setup();
    const app = appFor(provider);
    for (const repo of ["/somewhere/else", missing]) {
      const res = await request(app).post("/api/prs/open").send({ repo, number: 3 });
      expect(res.status).toBe(400);
    }
    expect(provider.openPr).not.toHaveBeenCalled();
  });

  it("rejects a PR number that is not a positive integer", async () => {
    const { gh, provider } = setup();
    for (const number of [0, -1, 1.5, "3", 99999999999999999999]) {
      const res = await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number });
      expect(res.status).toBe(400);
    }
    expect(provider.openPr).not.toHaveBeenCalled();
  });

  it("opens a PR in a linked repo", async () => {
    const { gh, provider } = setup();
    const res = await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ head: "h", base: "b", body: "" });
    expect(provider.openPr).toHaveBeenCalledWith(gh, 3);
  });

  it("answers 502 when opening the PR fails", async () => {
    const { gh, provider } = setup();
    provider.openPr.mockRejectedValue(new PrUnavailableError("failed", "fetch failed"));
    const res = await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number: 3 });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "fetch failed", reason: "failed" });
  });

  it("never sends credentials from an upstream error to the browser", async () => {
    const { gh, provider } = setup();
    provider.openPr.mockRejectedValue(
      new Error("fatal: unable to access 'https://user:s3cret@github.com/o/r.git/': 403"),
    );
    const res = await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number: 3 });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("s3cret");
    expect(res.body.reason).toBe("failed");
  });

  it("GET /api/prs/comments returns the provider's comments", async () => {
    const { gh, provider } = setup();
    const comments: ReviewComment[] = [
      {
        id: 7,
        replyTo: null,
        path: "src/a.ts",
        line: 4,
        side: "new",
        author: "rev",
        body: "nit",
        createdAt: "2026-11-22T00:00:00Z",
        url: "https://github.com/o/r/pull/3#discussion_r7",
        commitId: "headsha",
      },
    ];
    provider.reviewComments.mockResolvedValue(comments);
    const res = await request(appFor(provider)).get("/api/prs/comments").query({ repo: gh, number: "3" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(comments);
    expect(provider.reviewComments).toHaveBeenCalledWith(gh, 3);
  });

  it("GET /api/prs/comments rejects an invalid number", async () => {
    const { gh, provider } = setup();
    const app = appFor(provider);
    for (const number of [undefined, "", "0", "-1", "1.5", "abc", "3x", "99999999999999999999"]) {
      const query = number === undefined ? { repo: gh } : { repo: gh, number };
      const res = await request(app).get("/api/prs/comments").query(query);
      expect(res.status).toBe(400);
    }
    expect(provider.reviewComments).not.toHaveBeenCalled();
  });

  it("GET /api/prs/comments rejects an unlinked repo", async () => {
    const { missing, provider } = setup();
    const app = appFor(provider);
    for (const repo of ["/somewhere/else", missing]) {
      const res = await request(app).get("/api/prs/comments").query({ repo, number: "3" });
      const open = await request(app).post("/api/prs/open").send({ repo, number: 3 });
      expect(res.status).toBe(400);
      expect(res.status).toBe(open.status);
      expect(res.body).toEqual(open.body);
    }
    expect(provider.reviewComments).not.toHaveBeenCalled();
  });

  it("GET /api/prs/comments maps provider unavailability like /open", async () => {
    const { gh, provider } = setup();
    const app = appFor(provider);
    for (const err of [
      new PrUnavailableError("gh-unauthenticated", "not logged in"),
      new Error("fatal: unable to access 'https://user:s3cret@github.com/o/r.git/': 403"),
    ]) {
      provider.reviewComments.mockRejectedValueOnce(err);
      provider.openPr.mockRejectedValueOnce(err);
      const res = await request(app).get("/api/prs/comments").query({ repo: gh, number: "3" });
      const open = await request(app).post("/api/prs/open").send({ repo: gh, number: 3 });
      expect(res.status).toBe(502);
      expect(res.status).toBe(open.status);
      expect(res.body).toEqual(open.body);
      expect(JSON.stringify(res.body)).not.toContain("s3cret");
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "opens a PR although an unrelated project has an unreadable file",
    async () => {
      const { gh, provider } = setup();
      const other = join(projects.dir(), "other");
      mkdirSync(join(other, "wiki"), { recursive: true });
      writeFileSync(join(other, "PROJECT.md"), "# other\n");
      writeFileSync(join(other, "wiki", "log.md"), "## [2026-01-01]\n");
      chmodSync(join(other, "wiki", "log.md"), 0);
      const res = await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number: 3 });
      expect(res.status).toBe(200);
    },
  );

  it("treats a symlinked project the same for listing and opening", async () => {
    const { gh, provider } = setup();
    // Inside projectsDir: a project for both endpoints.
    symlinkSync(join(projects.dir(), "proj"), join(projects.dir(), "alias"), "dir");
    expect((await request(appFor(provider)).get("/api/prs?project=alias")).status).toBe(200);

    // Outside projectsDir: a project for neither.
    const outside = join(projects.root(), "outside");
    const outRepo = join(projects.root(), "out-repo");
    mkdirSync(outside);
    mkdirSync(outRepo);
    writeFileSync(join(outside, "PROJECT.md"), "# out\n");
    writeFileSync(join(outside, "repos.json"), JSON.stringify([{ name: "out", path: outRepo }]));
    symlinkSync(outside, join(projects.dir(), "evil"), "dir");
    expect((await request(appFor(provider)).get("/api/prs?project=evil")).status).toBe(404);
    const open = await request(appFor(provider)).post("/api/prs/open").send({ repo: outRepo, number: 3 });
    expect(open.status).toBe(400);
    expect((await request(appFor(provider)).post("/api/prs/open").send({ repo: gh, number: 3 })).status).toBe(200);
  });

  describe("per-forge routing", () => {
    it("mixed project lists rows from both providers newest first", async () => {
      const { gh, gl, missing, github, gitlab, resolveForge, app } = setupMixed();
      const res = await request(app).get("/api/prs?project=mix");
      expect(res.status).toBe(200);
      expect(res.body.prs.map((p: PullRequest) => [p.repo, p.number])).toEqual([
        ["hub", 3],
        ["lab", 2],
        ["hub", 1],
      ]);
      expect(github.listOpen.mock.calls.map((c) => c[0])).toEqual([gh]);
      expect(gitlab.listOpen.mock.calls.map((c) => c[0])).toEqual([gl]);
      // The repos.json override reaches the resolver; a missing repo is never resolved.
      expect(resolveForge).toHaveBeenCalledWith({ repoPath: gl, forge: "gitlab" });
      expect(resolveForge.mock.calls.map((c) => c[0].repoPath)).not.toContain(missing);
    });

    it("unknown forge rests with host and calls no provider", async () => {
      const { unk, github, gitlab, app } = setupMixed();
      const res = await request(app).get("/api/prs?project=mix");
      expect(res.body.unavailable).toEqual([{ repo: "odd", reason: "unknown-forge", host: "code.example.org" }]);
      for (const p of [github, gitlab]) expect(p.listOpen.mock.calls.map((c) => c[0])).not.toContain(unk);
    });

    it("glab unauthenticated carries host", async () => {
      const { gitlab, app } = setupMixed();
      gitlab.listOpen.mockRejectedValue(new PrUnavailableError("glab-unauthenticated", "401", "git.example.com"));
      const res = await request(app).get("/api/prs?project=mix");
      expect(res.body.unavailable).toContainEqual({ repo: "lab", reason: "glab-unauthenticated", host: "git.example.com" });
      expect(res.body.prs.map((p: PullRequest) => p.repo)).toEqual(["hub", "hub"]);
    });

    it("one, open and comments dispatch to the gitlab provider", async () => {
      const { gl, github, gitlab, app } = setupMixed();
      const one = await request(app).get("/api/prs/one").query({ project: "mix", repo: "lab", number: "2" });
      expect(one.status).toBe(200);
      expect(one.body.repo).toBe("lab");
      const open = await request(app).post("/api/prs/open").send({ repo: gl, number: 2 });
      expect(open.body).toEqual({ head: "gitlab-h", base: "gitlab-b", body: "gitlab" });
      const comments = await request(app).get("/api/prs/comments").query({ repo: gl, number: "2" });
      expect(comments.status).toBe(200);
      expect(gitlab.getPr).toHaveBeenCalledWith(gl, 2);
      expect(gitlab.openPr).toHaveBeenCalledWith(gl, 2);
      expect(gitlab.reviewComments).toHaveBeenCalledWith(gl, 2);
      for (const fn of [github.getPr, github.openPr, github.reviewComments]) expect(fn).not.toHaveBeenCalled();

      gitlab.openPr.mockRejectedValueOnce(new PrUnavailableError("glab-unauthenticated", "no token", "git.example.com"));
      gitlab.reviewComments.mockRejectedValueOnce(new PrUnavailableError("glab-missing", "glab not found"));
      const openFail = await request(app).post("/api/prs/open").send({ repo: gl, number: 2 });
      const commentsFail = await request(app).get("/api/prs/comments").query({ repo: gl, number: "2" });
      expect(openFail.status).toBe(502);
      expect(openFail.body.reason).toBe("glab-unauthenticated");
      expect(commentsFail.status).toBe(502);
      expect(commentsFail.body.reason).toBe("glab-missing");
    });

    it("open, comments and the list pick the same entry when several link the path", async () => {
      const shared = join(projects.root(), "shared-repo");
      mkdirSync(shared);
      // "aa-plain" lists first and sets no forge; "zz-forced" forces gitlab.
      for (const [name, entry] of [
        ["aa-plain", { name: "plain", path: shared }],
        ["zz-forced", { name: "forced", path: shared, forge: "gitlab" }],
      ] as const) {
        const dir = join(projects.dir(), name);
        mkdirSync(dir);
        writeFileSync(join(dir, "PROJECT.md"), `# ${name}\n`);
        writeFileSync(join(dir, "repos.json"), JSON.stringify([entry]));
      }
      const github = fakeProvider("github", () => []);
      const gitlab = fakeProvider("gitlab", (p) => [{ ...pr(p, 2, "2026-11-21T00:00:00Z"), forge: "gitlab" as const }]);
      // Only the override makes this host GitLab.
      const resolveForge = async (e: { repoPath: string; forge?: Forge }): Promise<ResolvedForge> =>
        e.forge ? { forge: e.forge, host: "git.example.org", projectPath: "g/shared" } : { forge: "unknown", host: "git.example.org" };
      const app = makeApp(createPrsRouter({ github, gitlab }, { resolveForge }), "/api/prs");

      const list = await request(app).get("/api/prs?project=zz-forced");
      expect(list.body.prs.map((p: PullRequest) => p.forge)).toEqual(["gitlab"]);
      const open = await request(app).post("/api/prs/open").send({ repo: shared, number: 2 });
      expect(open.status).toBe(200);
      expect(open.body.body).toBe("gitlab");
      const comments = await request(app).get("/api/prs/comments").query({ repo: shared, number: "2" });
      expect(comments.status).toBe(200);
      expect(gitlab.reviewComments).toHaveBeenCalledWith(shared, 2);
    });

    it("one forge per repo path: every route from any linking project reaches the forced forge", async () => {
      const shared = join(projects.root(), "one-forge-repo");
      mkdirSync(shared);
      // "aa-other" lists first and sets no forge; "zz-forcer" forces gitlab on the same path.
      for (const [name, entry] of [
        ["aa-other", { name: "other", path: shared }],
        ["zz-forcer", { name: "forcer", path: shared, forge: "gitlab" }],
      ] as const) {
        const dir = join(projects.dir(), name);
        mkdirSync(dir);
        writeFileSync(join(dir, "PROJECT.md"), `# ${name}\n`);
        writeFileSync(join(dir, "repos.json"), JSON.stringify([entry]));
      }
      const github = fakeProvider("github", (p) => [pr(p, 9, "2026-11-20T00:00:00Z")]);
      const gitlab = fakeProvider("gitlab", (p) => [{ ...pr(p, 2, "2026-11-21T00:00:00Z"), forge: "gitlab" as const }]);
      // Without the override the path would resolve to GitHub.
      const resolveForge = async (e: { repoPath: string; forge?: Forge }): Promise<ResolvedForge> =>
        e.forge === "gitlab"
          ? { forge: "gitlab", host: "git.example.org", projectPath: "g/shared" }
          : { forge: "github", host: "github.com", projectPath: "o/shared" };
      const app = makeApp(createPrsRouter({ github, gitlab }, { resolveForge }), "/api/prs");

      const fromOther = await request(app).get("/api/prs?project=aa-other");
      expect(fromOther.body.prs.map((p: PullRequest) => [p.forge, p.repo])).toEqual([["gitlab", "other"]]);
      // The path-keyed cache serves the same forge's rows to the forcing project.
      const fromForcer = await request(app).get("/api/prs?project=zz-forcer");
      expect(fromForcer.body.prs.map((p: PullRequest) => [p.forge, p.repo])).toEqual([["gitlab", "forcer"]]);
      expect(gitlab.listOpen).toHaveBeenCalledTimes(1);

      const one = await request(app).get("/api/prs/one").query({ project: "aa-other", repo: "other", number: "2" });
      expect(one.status).toBe(200);
      expect(gitlab.getPr).toHaveBeenCalledWith(shared, 2);
      const open = await request(app).post("/api/prs/open").send({ repo: shared, number: 2 });
      expect(open.body.body).toBe("gitlab");
      const comments = await request(app).get("/api/prs/comments").query({ repo: shared, number: "2" });
      expect(comments.status).toBe(200);
      expect(gitlab.reviewComments).toHaveBeenCalledWith(shared, 2);
      expect(github.listOpen).not.toHaveBeenCalled();
      expect(github.getPr).not.toHaveBeenCalled();
      expect(github.openPr).not.toHaveBeenCalled();
      expect(github.reviewComments).not.toHaveBeenCalled();
    });

    it("one failure returns reason and host", async () => {
      const { github, gitlab, app } = setupMixed();
      gitlab.getPr.mockRejectedValueOnce(new PrUnavailableError("glab-unauthenticated", "401", "git.example.com"));
      const res = await request(app).get("/api/prs/one").query({ project: "mix", repo: "lab", number: "2" });
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ unavailable: "glab-unauthenticated", host: "git.example.com" });

      const unknown = await request(app).get("/api/prs/one").query({ project: "mix", repo: "odd", number: "2" });
      expect(unknown.status).toBe(502);
      expect(unknown.body).toEqual({ unavailable: "unknown-forge", host: "code.example.org" });
      expect(github.getPr).not.toHaveBeenCalled();
      expect(gitlab.getPr).toHaveBeenCalledTimes(1);
    });

    it("identity comes from the github provider only", async () => {
      const { github, gitlab, app } = setupMixed();
      const res = await request(app).get("/api/prs?project=mix");
      expect(res.body.me).toBe("github-me");
      expect(github.whoami).toHaveBeenCalledTimes(1);
      expect(gitlab.whoami).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/prs/one", () => {
    const one = (query: Record<string, string>) => ({ project: "proj", repo: "GitHub Repo", number: "3", ...query });

    it("one: 400 on a bad number or empty repo", async () => {
      const { provider } = setup();
      const app = appFor(provider);
      for (const number of [undefined, "", "0", "-1", "1.5", "abc", "3x", "99999999999999999999"]) {
        const query = one({});
        if (number === undefined) delete (query as Partial<typeof query>).number;
        else query.number = number;
        const res = await request(app).get("/api/prs/one").query(query);
        expect(res.status).toBe(400);
      }
      for (const repo of ["", "  "]) {
        const res = await request(app).get("/api/prs/one").query(one({ repo }));
        expect(res.status).toBe(400);
      }
      expect(provider.getPr).not.toHaveBeenCalled();
    });

    it("one: 404 on an unknown project or unlinked repo", async () => {
      const { provider } = setup();
      const app = appFor(provider);
      for (const query of [one({ project: "nope" }), one({ repo: "not-in-repos-json" }), one({ repo: "missing-repo" })]) {
        const res = await request(app).get("/api/prs/one").query(query);
        expect(res.status).toBe(404);
      }
      expect(provider.getPr).not.toHaveBeenCalled();
    });

    it("one: 502 carries the unavailable reason", async () => {
      const { gl, provider } = setup();
      provider.getPr.mockRejectedValueOnce(new PrUnavailableError("unknown-forge"));
      const app = appFor(provider);
      const res = await request(app).get("/api/prs/one").query(one({ repo: "gl-repo" }));
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ unavailable: "unknown-forge" });
      expect(provider.getPr).toHaveBeenCalledWith(gl, 3);

      provider.getPr.mockRejectedValueOnce(new Error("boom"));
      const other = await request(app).get("/api/prs/one").query(one({ repo: "gl-repo", number: "4" }));
      expect(other.status).toBe(502);
      expect(other.body).toEqual({ unavailable: "failed" });
    });

    it("one: caches for 60 s and fresh=1 bypasses the cache", async () => {
      const { provider } = setup();
      let t = 1_000_000;
      const app = appFor(provider, () => t);
      await request(app).get("/api/prs/one").query(one({}));
      t += 59_000;
      const second = await request(app).get("/api/prs/one").query(one({}));
      expect(second.status).toBe(200);
      expect(provider.getPr).toHaveBeenCalledTimes(1);
      // Another PR in the same repo is its own entry.
      await request(app).get("/api/prs/one").query(one({ number: "4" }));
      expect(provider.getPr).toHaveBeenCalledTimes(2);
      await request(app).get("/api/prs/one").query(one({ fresh: "1" }));
      expect(provider.getPr).toHaveBeenCalledTimes(3);
      // PR 4 was fetched at +59 s: 60 s later it has expired.
      t += 60_000;
      await request(app).get("/api/prs/one").query(one({ number: "4" }));
      expect(provider.getPr).toHaveBeenCalledTimes(4);
    });

    it("one: an older provider call finishing last never overwrites the newer cache entry", async () => {
      const { gh, provider } = setup();
      const deferred: ((title: string) => void)[] = [];
      provider.getPr.mockImplementation(
        (p: string, n: number) =>
          new Promise((resolve) => {
            deferred.push((title) => resolve({ ...pr(p, n, "2026-11-22T00:00:00Z"), title, state: "merged" as const }));
          }),
      );
      const app = appFor(provider);
      const older = request(app).get("/api/prs/one").query(one({ fresh: "1" })).then((r) => r);
      await vi.waitFor(() => expect(deferred).toHaveLength(1));
      const newer = request(app).get("/api/prs/one").query(one({ fresh: "1" })).then((r) => r);
      await vi.waitFor(() => expect(deferred).toHaveLength(2));
      deferred[1]("newer");
      expect((await newer).body.title).toBe("newer");
      deferred[0]("older");
      expect((await older).body.title).toBe("older");
      // The cache keeps the newest call's result.
      const cached = await request(app).get("/api/prs/one").query(one({}));
      expect(cached.body.title).toBe("newer");
      expect(provider.getPr).toHaveBeenCalledTimes(2);
      expect(provider.getPr).toHaveBeenCalledWith(gh, 3);
    });

    it("one: labels the PR with the repos.json name", async () => {
      const { gh, provider } = setup();
      const res = await request(appFor(provider)).get("/api/prs/one").query(one({}));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...pr(gh, 3, "2026-11-22T00:00:00Z"), repo: "GitHub Repo", state: "merged" });
      expect(provider.getPr).toHaveBeenCalledWith(gh, 3);
    });
  });
});

describe("gitlabResolveFor", () => {
  const repo = "/srv/x/forced-repo";
  // origin on a host neither GitHub nor in glab's config.
  const resolveForge = createForgeResolver({
    run: async () => ({ code: 0, stdout: "git@git.example.org:grp/forced-repo.git\n", stderr: "" }),
    readGlabConfig: () => null,
  });

  it("resolves a forced-gitlab entry on an unknown host to gitlab", async () => {
    const resolve = gitlabResolveFor(resolveForge, () => [
      { name: "forced", path: repo, present: true, forge: "gitlab" },
    ]);
    expect(await resolve(repo)).toEqual({ forge: "gitlab", host: "git.example.org", projectPath: "grp/forced-repo" });
    // Without the override the same remote is an unknown forge.
    const plain = gitlabResolveFor(resolveForge, () => [{ name: "plain", path: repo, present: true }]);
    expect(await plain(repo)).toEqual({ forge: "unknown", host: "git.example.org" });
  });

  it("prefers the entry that sets forge when several share the path", async () => {
    const resolve = gitlabResolveFor(resolveForge, () => [
      { name: "plain", path: repo, present: true },
      { name: "forced", path: repo, present: true, forge: "gitlab" },
    ]);
    expect((await resolve(repo)).forge).toBe("gitlab");
  });
});
