import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveProject, type FetchLike } from "../project";

let root = "";

const REGISTRY = [
  "| Project | Type | Path |",
  "| ------- | ---- | ---- |",
  "| metro | work | `<root>/projects/metro/` |",
  "| pavilio | private | `<root>/projects/pavilio/` |",
  "",
  "## Archived Projects",
  "",
  "| Project | Path |",
  "|---------|------|",
  "| old | `projects/archived/old/` |",
  "",
].join("\n");

/** A fetch stub that records the URL and answers with `body` (or throws when `body` is an Error). */
function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const headers: (Record<string, string> | undefined)[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(String(url));
    headers.push(init?.headers);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls, headers };
}

const noFetch: FetchLike = async () => {
  throw new Error("fetch must not be called");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-project-"));
  writeFileSync(join(root, ".projects.local.md"), REGISTRY);
  mkdirSync(join(root, "projects", "metro", "notes"), { recursive: true });
  mkdirSync(join(root, "projects", "pavilio"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveProject", () => {
  it("resolves an explicit project", async () => {
    const base = { workspaceRoot: root, cwd: join(root, "projects", "metro"), env: {}, fetch: noFetch };
    expect(await resolveProject({ ...base, name: "pavilio" })).toEqual({
      ok: true,
      project: "pavilio",
      via: "arg",
    });
    // the `<project>:` prefix form
    expect(await resolveProject({ ...base, name: "pavilio:" })).toMatchObject({ project: "pavilio" });
    // a name that is not registered asks instead of falling through to cwd
    expect(await resolveProject({ ...base, name: "nope" })).toMatchObject({ ok: false, ask: true });
    expect(await resolveProject({ ...base, name: "old" })).toMatchObject({ ok: false, ask: true });
  });

  it("resolves from cwd", async () => {
    const res = await resolveProject({
      workspaceRoot: root,
      cwd: join(root, "projects", "metro", "notes"),
      env: { PAVILIO_TERMINAL_ID: "t1" },
      fetch: noFetch,
    });
    expect(res).toEqual({ ok: true, project: "metro", via: "cwd" });
    // a workspace reached through a symlink still resolves
    const linkDir = mkdtempSync(join(tmpdir(), "wiki-project-link-"));
    const link = join(linkDir, "ws");
    symlinkSync(root, link);
    const viaLink = await resolveProject({
      workspaceRoot: root,
      cwd: join(link, "projects", "metro"),
      env: {},
      fetch: noFetch,
    });
    rmSync(linkDir, { recursive: true, force: true });
    expect(viaLink).toEqual({ ok: true, project: "metro", via: "cwd" });
  });

  it("resolves from the panel cell", async () => {
    const { fetch, calls, headers } = stubFetch([
      { id: "t0", project: "metro" },
      { id: "t1", project: "pavilio" },
    ]);
    const res = await resolveProject({
      workspaceRoot: root,
      cwd: root,
      env: { PAVILIO_TERMINAL_ID: "t1", PAVILIO_PANEL_URL: "http://127.0.0.1:4999/" },
      fetch,
    });
    expect(res).toEqual({ ok: true, project: "pavilio", via: "cell" });
    expect(calls).toEqual(["http://127.0.0.1:4999/api/terminal/sessions"]);
    expect(headers[0]?.authorization).toBeUndefined();

    // a token-protected panel gets the bearer token
    const withToken = stubFetch([{ id: "t1", project: "pavilio" }]);
    await resolveProject({
      workspaceRoot: root,
      cwd: root,
      env: { PAVILIO_TERMINAL_ID: "t1", PANEL_TOKEN: "s3cret" },
      fetch: withToken.fetch,
    });
    expect(withToken.headers[0]).toEqual({ authorization: "Bearer s3cret" });
  });

  it("asks when nothing resolves", async () => {
    // no name, cwd outside projects/, no terminal id
    expect(await resolveProject({ workspaceRoot: root, cwd: tmpdir(), env: {}, fetch: noFetch })).toMatchObject({
      ok: false,
      ask: true,
    });
    // cell listed without a project, or not listed at all
    for (const sessions of [[{ id: "t1", project: "" }], [{ id: "t2", project: "metro" }]]) {
      const { fetch } = stubFetch(sessions);
      expect(
        await resolveProject({ workspaceRoot: root, cwd: root, env: { PAVILIO_TERMINAL_ID: "t1" }, fetch }),
      ).toMatchObject({ ok: false, ask: true });
    }
  });

  it("asks when the sessions api fails", async () => {
    const env = { PAVILIO_TERMINAL_ID: "t1" };
    for (const { fetch } of [stubFetch(new Error("ECONNREFUSED")), stubFetch({ error: "x" }, 500), stubFetch({})]) {
      const res = await resolveProject({ workspaceRoot: root, cwd: root, env, fetch });
      expect(res).toMatchObject({ ok: false, ask: true });
    }
  });

  describe("like discovery: a projects/<name>/PROJECT.md is a project", () => {
    beforeEach(() => {
      mkdirSync(join(root, "projects", "my-pet-project", "notes"), { recursive: true });
      writeFileSync(join(root, "projects", "my-pet-project", "PROJECT.md"), "# my pet project\n");
    });

    it("resolves via arg, cwd and cell without a registry", async () => {
      rmSync(join(root, ".projects.local.md"));
      const base = { workspaceRoot: root, env: {}, fetch: noFetch };
      expect(await resolveProject({ ...base, cwd: root, name: "my-pet-project" })).toEqual({
        ok: true,
        project: "my-pet-project",
        via: "arg",
      });
      expect(await resolveProject({ ...base, cwd: join(root, "projects", "my-pet-project", "notes") })).toEqual({
        ok: true,
        project: "my-pet-project",
        via: "cwd",
      });
      const { fetch } = stubFetch([{ id: "t1", project: "my-pet-project" }]);
      expect(await resolveProject({ workspaceRoot: root, cwd: root, env: { PAVILIO_TERMINAL_ID: "t1" }, fetch })).toEqual({
        ok: true,
        project: "my-pet-project",
        via: "cell",
      });
    });

    it("resolves an unlisted project dir next to a registry", async () => {
      expect(await resolveProject({ workspaceRoot: root, cwd: root, env: {}, fetch: noFetch, name: "my-pet-project" })).toMatchObject({
        ok: true,
        project: "my-pet-project",
      });
    });

    it("asks for a project the registry lists as archived, even with a PROJECT.md", async () => {
      mkdirSync(join(root, "projects", "old"), { recursive: true });
      writeFileSync(join(root, "projects", "old", "PROJECT.md"), "# old\n");
      expect(await resolveProject({ workspaceRoot: root, cwd: root, env: {}, fetch: noFetch, name: "old" })).toMatchObject({
        ok: false,
        ask: true,
      });
    });

    it("asks for an unknown dir", async () => {
      rmSync(join(root, ".projects.local.md"));
      mkdirSync(join(root, "projects", "scratch"), { recursive: true }); // no PROJECT.md
      const base = { workspaceRoot: root, env: {}, fetch: noFetch };
      expect(await resolveProject({ ...base, cwd: root, name: "scratch" })).toMatchObject({ ok: false, ask: true });
      expect(await resolveProject({ ...base, cwd: root, name: "ghost" })).toMatchObject({ ok: false, ask: true });
      expect(await resolveProject({ ...base, cwd: root, name: "../projects" })).toMatchObject({ ok: false, ask: true });
      expect(await resolveProject({ ...base, cwd: join(root, "projects", "scratch") })).toMatchObject({ ok: false, ask: true });
    });
  });
});
