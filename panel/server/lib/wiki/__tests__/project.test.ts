import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
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
  const fetch: FetchLike = async (url) => {
    calls.push(String(url));
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
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
  });

  it("resolves from the panel cell", async () => {
    const { fetch, calls } = stubFetch([
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
});
