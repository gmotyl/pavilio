import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";
import { PrUnavailableError, type PrProvider, type PullRequest } from "../../lib/prs/provider";

const projects = withProjectsDir("prs-route-");
vi.mock("../../config", () => configMock(() => projects.dir()));

import { createPrsRouter } from "../prs";

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
    base: "main",
    updatedAt,
    url: `https://github.com/o/r/pull/${number}`,
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
      throw new PrUnavailableError("not-github");
    }),
    openPr: vi.fn(async () => ({ head: "h", base: "b", body: "" })),
  } satisfies PrProvider;
  return { gh, gl, missing, provider };
}

const appFor = (provider: PrProvider, now?: () => number) =>
  makeApp(createPrsRouter(provider, now ? { now } : {}), "/api/prs");

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
    expect(res.body.unavailable).toEqual([{ repo: "gl-repo", reason: "not-github" }]);
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
    for (const number of [0, -1, 1.5, "3"]) {
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
});
