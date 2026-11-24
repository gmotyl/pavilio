import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv.js";

const ws = withProjectsDir("proj-group-");
vi.mock("../../config", () => configMock(() => ws.dir()));

import projectsRouter from "../projects";

const app = () => makeApp(projectsRouter, "/api/projects");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ws.root(), env: gitSafeEnv(), encoding: "utf8" }).trim();

function card(name: string, group?: string): void {
  mkdirSync(join(ws.dir(), name), { recursive: true });
  const fm = group ? `group: ${group}\n` : "";
  writeFileSync(join(ws.dir(), name, "PROJECT.md"), `---\nkind: project\n${fm}---\n# ${name}\n\nBody.\n`);
}
const read = (name: string) => readFileSync(join(ws.dir(), name, "PROJECT.md"), "utf8");
const lastFiles = () => git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
const lastMsg = () => git("log", "-1", "--format=%s");
const count = () => Number(git("rev-list", "--count", "HEAD"));

beforeEach(() => {
  card("anytts");
  card("alpha", "Old");
  card("beta", "Old");
  card("gamma", "Other");
  mkdirSync(join(ws.dir(), "archived"), { recursive: true });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

describe("project group endpoints", () => {
  it("put group rewrites and commits one path", async () => {
    const res = await request(app()).put("/api/projects/anytts/group").send({ group: "InfoPoly" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ group: "InfoPoly" });
    expect(read("anytts")).toContain("group: InfoPoly\n");
    expect(lastFiles()).toEqual(["projects/anytts/PROJECT.md"]);
    expect(lastMsg()).toBe("panel: group anytts → InfoPoly");
    expect(git("status", "--porcelain")).toBe("");
    const list = await request(app()).get("/api/projects");
    expect(list.body.find((p: { name: string }) => p.name === "anytts").group).toBe("InfoPoly");
  });

  it("put null removes the group and commits", async () => {
    const res = await request(app()).put("/api/projects/alpha/group").send({ group: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ group: null });
    expect(read("alpha")).not.toContain("group:");
    expect(lastFiles()).toEqual(["projects/alpha/PROJECT.md"]);
    expect(lastMsg()).toBe("panel: group alpha → none");
  });

  it("rename rewrites all members in one commit", async () => {
    const before = count();
    const res = await request(app()).post("/api/projects/groups/rename").send({ from: "Old", to: "New" });
    expect(res.status).toBe(200);
    expect(res.body.renamed.sort()).toEqual(["alpha", "beta"]);
    expect(read("alpha")).toContain("group: New\n");
    expect(read("beta")).toContain("group: New\n");
    expect(read("gamma")).toContain("group: Other\n");
    expect(count()).toBe(before + 1);
    expect(lastFiles()).toEqual(["projects/alpha/PROJECT.md", "projects/beta/PROJECT.md"]);
    expect(lastMsg()).toBe("panel: rename group Old → New");
  });

  it("rename collision is 409 and writes nothing", async () => {
    const before = count();
    const res = await request(app()).post("/api/projects/groups/rename").send({ from: "Old", to: "Other" });
    expect(res.status).toBe(409);
    expect(read("alpha")).toContain("group: Old\n");
    expect(count()).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("unrelated dirty files stay out of the commit", async () => {
    writeFileSync(join(ws.dir(), "gamma", "PROJECT.md"), read("gamma") + "dirty\n");
    writeFileSync(join(ws.dir(), "beta", "notes.md"), "staged\n");
    git("add", "projects/beta/notes.md");
    const res = await request(app()).put("/api/projects/anytts/group").send({ group: "InfoPoly" });
    expect(res.status).toBe(200);
    expect(lastFiles()).toEqual(["projects/anytts/PROJECT.md"]);
    const status = git("status", "--porcelain");
    expect(status).toContain("A  projects/beta/notes.md");
    expect(status).toContain(" M projects/gamma/PROJECT.md");
  });

  it("a glob-like project name commits only its own card", async () => {
    card("foo*");
    card("foobar");
    git("add", "-A");
    git("commit", "-q", "-m", "more");
    writeFileSync(join(ws.dir(), "foobar", "PROJECT.md"), read("foobar") + "\nDirty.\n");
    const res = await request(app()).put("/api/projects/foo*/group").send({ group: "G" });
    expect(res.status).toBe(200);
    expect(lastFiles()).toEqual(["projects/foo*/PROJECT.md"]);
    expect(git("status", "--porcelain")).toBe("M projects/foobar/PROJECT.md");
  });

  it("git failure restores the file and returns 500", async () => {
    const hook = join(ws.root(), ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho hook-says-no >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const original = read("anytts");
    const before = count();
    const res = await request(app()).put("/api/projects/anytts/group").send({ group: "InfoPoly" });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("hook-says-no");
    expect(read("anytts")).toBe(original);
    expect(count()).toBe(before);
  });

  it("unknown project is 404", async () => {
    const put = await request(app()).put("/api/projects/nope/group").send({ group: "X" });
    expect(put.status).toBe(404);
    const ren = await request(app()).post("/api/projects/groups/rename").send({ from: "Nope", to: "X" });
    expect(ren.status).toBe(404);
  });

  it("invalid group names are 400 and write nothing", async () => {
    const before = count();
    for (const group of ["a\nb", "a\rb", "x".repeat(65)]) {
      const put = await request(app()).put("/api/projects/anytts/group").send({ group });
      expect(put.status).toBe(400);
      const ren = await request(app()).post("/api/projects/groups/rename").send({ from: "Old", to: group });
      expect(ren.status).toBe(400);
    }
    expect(count()).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });
  it("put group refuses a knowledge wiki, grouped or not", async () => {
    for (const [name, group] of [["knowledge", undefined], ["old-wiki", "Old"]] as const) {
      mkdirSync(join(ws.dir(), name), { recursive: true });
      const fm = group ? `group: ${group}\n` : "";
      writeFileSync(join(ws.dir(), name, "PROJECT.md"), `---\nkind: knowledge\n${fm}---\n# ${name}\n`);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "wikis");
    const before = count();
    for (const [name, group] of [["knowledge", "Old"], ["old-wiki", "Other"], ["old-wiki", null]] as const) {
      const res = await request(app()).put(`/api/projects/${name}/group`).send({ group });
      expect(res.status, `${name} → ${group}`).toBe(409);
      expect(res.body.error).toMatch(/knowledge/);
    }
    expect(read("knowledge")).not.toContain("group:");
    expect(read("old-wiki")).toContain("group: Old\n");
    expect(count()).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });
});
