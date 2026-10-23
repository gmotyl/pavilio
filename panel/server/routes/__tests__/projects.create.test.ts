import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("proj-create-");

vi.mock("../../config", () => configMock(() => projects.dir()));

// Every process-starting call is a call-through spy: the scaffold must run in-process, so none
// of them may fire while a create request is served.
const spawned = vi.hoisted(() => ({ names: [] as string[] }));
async function childProcessSpies(importOriginal: () => Promise<Record<string, unknown>>) {
  const actual = await importOriginal();
  const out: Record<string, unknown> = { ...actual };
  for (const fn of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const original = actual[fn] as (...args: unknown[]) => unknown;
    out[fn] = (...args: unknown[]) => {
      spawned.names.push(fn);
      return original(...args);
    };
  }
  return { ...out, default: out };
}
vi.mock("child_process", (importOriginal) => childProcessSpies(importOriginal));
vi.mock("node:child_process", (importOriginal) => childProcessSpies(importOriginal));

import projectsRouter from "../projects";
import { scaffoldProject } from "../../lib/projects/scaffold";
import { localISODate } from "../../lib/dateLocal";

const app = () => makeApp(projectsRouter, "/api/projects");

/** Every file under `dir` (posix-relative path → content), the shape compared against the scaffold. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string) => {
    for (const e of readdirSync(abs)) {
      const p = join(abs, e);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split("\\").join("/")] = readFileSync(p, "utf-8");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

beforeEach(() => {
  spawned.names.length = 0;
});

describe("POST /api/projects", () => {
  it("creates a research project from a title", async () => {
    const res = await request(app())
      .post("/api/projects")
      .send({ title: "Edge TTS voices", kind: "research", topic: "edge tts voices" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: "edge-tts-voices" });

    // The reference: scaffoldProject's own research output in a fresh projects dir.
    const refDir = join(mkdtempSync(join(tmpdir(), "proj-create-ref-")), "projects");
    try {
      mkdirSync(refDir);
      const ref = scaffoldProject({
        projectsDir: refDir,
        name: "edge-tts-voices",
        kind: "research",
        topic: "edge tts voices",
        today: localISODate(),
      });
      expect(ref.ok).toBe(true);
      expect(tree(join(projects.dir(), "edge-tts-voices"))).toEqual(tree(join(refDir, "edge-tts-voices")));
    } finally {
      rmSync(join(refDir, ".."), { recursive: true, force: true });
    }
    expect(readFileSync(join(projects.dir(), "edge-tts-voices", "PROJECT.md"), "utf-8")).toMatch(/kind: research/);
    expect(spawned.names).toEqual([]);
  });

  it("creates an ordinary project without topic", async () => {
    const res = await request(app()).post("/api/projects").send({ title: "Żółta Łódź", kind: "project" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: "zolta-lodz" });
    const card = readFileSync(join(projects.dir(), "zolta-lodz", "PROJECT.md"), "utf-8");
    expect(card).toMatch(/kind: project/);
    expect(card).not.toMatch(/topic:/);
    expect(existsSync(join(projects.dir(), "zolta-lodz", "STATUS.md"))).toBe(true);
    expect(existsSync(join(projects.dir(), "zolta-lodz", "spikes"))).toBe(false);
    expect(spawned.names).toEqual([]);
  });

  it("409 exists for a live project", async () => {
    mkdirSync(join(projects.dir(), "alpha"));
    writeFileSync(join(projects.dir(), "alpha", "PROJECT.md"), "# alpha\n");
    // A card-less folder is taken too: the panel never fills in someone's notes dir.
    mkdirSync(join(projects.dir(), "notes-only"));
    writeFileSync(join(projects.dir(), "notes-only", "meeting.md"), "notes\n");
    const before = { alpha: tree(join(projects.dir(), "alpha")), notes: tree(join(projects.dir(), "notes-only")) };

    const live = await request(app()).post("/api/projects").send({ title: "Alpha", kind: "project" });
    expect(live.status).toBe(409);
    expect(live.body).toEqual({ reason: "exists", name: "alpha" });

    const bare = await request(app()).post("/api/projects").send({ title: "Notes only", kind: "project" });
    expect(bare.status).toBe(409);
    expect(bare.body).toEqual({ reason: "exists", name: "notes-only" });

    expect(tree(join(projects.dir(), "alpha"))).toEqual(before.alpha);
    expect(tree(join(projects.dir(), "notes-only"))).toEqual(before.notes);
  });

  it("409 archived for an archived project", async () => {
    mkdirSync(join(projects.dir(), "archived", "beta"), { recursive: true });
    writeFileSync(join(projects.dir(), "archived", "beta", "PROJECT.md"), "# beta\n");

    const res = await request(app()).post("/api/projects").send({ title: "Beta", kind: "research", topic: "b" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "archived", name: "beta" });
    expect(existsSync(join(projects.dir(), "beta"))).toBe(false);
  });

  it("400 for empty slug, missing topic, knowledge kind", async () => {
    const bad = [
      { title: "!!!", kind: "project" },
      { title: "Archived", kind: "project" },
      { title: "Some research", kind: "research" },
      { title: "Some research", kind: "research", topic: "   " },
      { title: "Shared", kind: "knowledge" },
      { title: 42, kind: "project" },
      { title: "Typo", kind: "proj" },
      { kind: "project" },
    ];
    for (const body of bad) {
      const res = await request(app()).post("/api/projects").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
    expect(readdirSync(projects.dir())).toEqual([]);
  });
});
