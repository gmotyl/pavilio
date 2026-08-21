import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";
vi.mock("../../config", () => ({ getConfig: () => ({ projectsDir }) }));

import { resolveOpenSpecRoot, parseOpenSpecConfig } from "../openspec";
import { discoverProjects } from "../discovery";

describe("resolveOpenSpecRoot", () => {
  it("resolves the repository root for native mode by default", () => {
    const r = resolveOpenSpecRoot({
      projectPath: "/data/projects/vector",
      repo: { name: "storefront", path: "/repos/storefront" },
      config: { mode: "native" },
    });
    expect(r).toEqual({
      mode: "native",
      root: "/repos/storefront",
      openspecDir: "/repos/storefront/openspec",
    });
  });

  it("resolves plans/<repo> as the default repo-store root", () => {
    const r = resolveOpenSpecRoot({
      projectPath: "/data/projects/vector",
      repo: { name: "storefront", path: "/repos/storefront" },
      config: { mode: "store" },
    });
    expect(r).toEqual({
      mode: "store",
      root: "/data/projects/vector/plans/storefront",
      openspecDir: "/data/projects/vector/plans/storefront/openspec",
    });
  });

  it("resolves plans/ as the default project-store root", () => {
    const r = resolveOpenSpecRoot({
      projectPath: "/data/projects/vector",
      config: { mode: "store" },
    });
    expect(r).toEqual({
      mode: "store",
      root: "/data/projects/vector/plans",
      openspecDir: "/data/projects/vector/plans/openspec",
    });
  });

  it("returns unconfigured instead of guessing a backend", () => {
    expect(
      resolveOpenSpecRoot({
        projectPath: "/data/projects/vector",
        repo: { name: "storefront", path: "/repos/storefront" },
        config: undefined,
      }),
    ).toEqual({ mode: "unconfigured" });
    // a repos.json entry with no openspec key parses to undefined, never a default
    expect(parseOpenSpecConfig({ name: "storefront", path: "/repos/storefront" })).toBeUndefined();
  });

  it("rejects traversal and malformed OpenSpec configuration", () => {
    // native custom root escaping the linked repository
    expect(() =>
      resolveOpenSpecRoot({
        projectPath: "/data/projects/vector",
        repo: { name: "storefront", path: "/repos/storefront" },
        config: { mode: "native", root: "../../etc" },
      }),
    ).toThrow();
    // store custom root escaping the project-local store root
    expect(() =>
      resolveOpenSpecRoot({
        projectPath: "/data/projects/vector",
        config: { mode: "store", root: "../../secrets" },
      }),
    ).toThrow();
    // unknown mode at resolution time
    expect(() =>
      resolveOpenSpecRoot({
        projectPath: "/data/projects/vector",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: { mode: "cli" } as any,
      }),
    ).toThrow();
    // unknown mode at parse time
    expect(() => parseOpenSpecConfig({ name: "x", path: "/x", openspec: { mode: "cli" } })).toThrow();
  });
});

describe("discoverProjects OpenSpec integration", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "osdisc-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("discovery no longer surfaces CURRENT.md plans", () => {
    const dir = join(projectsDir, "vector");
    mkdirSync(join(dir, "plans"), { recursive: true });
    writeFileSync(join(dir, "PROJECT.md"), "# vector\n");
    writeFileSync(join(dir, "plans", "CURRENT.md"), "some-plan\nother-plan\n");

    const projects = discoverProjects();
    const vector = projects.find((p) => p.name === "vector");

    expect(vector).toBeDefined();
    // currentPlans must no longer be emitted at all
    expect((vector as unknown as { currentPlans?: unknown }).currentPlans).toBeUndefined();
  });

  it("preserves valid openspec configuration from repos.json", () => {
    const dir = join(projectsDir, "vector");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT.md"), "# vector\n");
    writeFileSync(
      join(dir, "repos.json"),
      JSON.stringify([{ name: "storefront", path: "/repos/storefront", openspec: { mode: "native" } }]),
    );

    const projects = discoverProjects();
    const vector = projects.find((p) => p.name === "vector")!;

    expect(vector.repos[0].openspec).toEqual({ mode: "native" });
    const resolved = resolveOpenSpecRoot({
      projectPath: vector.path,
      repo: vector.repos[0],
      config: vector.repos[0].openspec,
    });
    expect(resolved).toEqual({
      mode: "native",
      root: "/repos/storefront",
      openspecDir: "/repos/storefront/openspec",
    });
  });
});
