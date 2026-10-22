import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import config from "../../vitest.config";

/**
 * The contract between the three vitest projects and the pre-push hook.
 *
 * `pnpm test` runs `browser` and `node` — the in-process suites. The suites that
 * drive real processes (shell scripts, the panel launcher, git sync, the speech
 * hooks) live in `node-slow`, which a push runs only when it touches what those
 * suites execute. That split holds only while three things agree: the slow
 * project's allowlist, the `node` project's excludes, and the hook's `SLOW`
 * subject pattern. A new process-driving suite that lands in `node` instead, or
 * a slow suite whose subject the pattern misses, silently stops being run.
 */
const PANEL = resolve(__dirname, "../..");

const SLOW_INCLUDE = [
  "server/__tests__/{setup-sh,update-sh,pm,panel-ctl,launcher-toolchain,setup-codex,setup-shortcut}.test.ts",
  "server/lib/__tests__/syncRepo.test.ts",
  "scripts/__tests__/install-speech-hook.test.ts",
  "hooks/__tests__/*.test.ts",
];

interface ProjectTest {
  name?: string;
  include?: string[];
  exclude?: string[];
  testTimeout?: number;
  fileParallelism?: boolean;
  pool?: string;
  sequence?: { groupOrder?: number };
}

function project(name: string): ProjectTest {
  const projects = (config as { test?: { projects?: Array<{ test?: ProjectTest }> } }).test?.projects ?? [];
  const found = projects.find((p) => p.test?.name === name)?.test;
  if (!found) throw new Error(`no vitest project named ${name}`);
  return found;
}

/** Expand vitest-style globs (brace sets included) against the panel tree. */
function expand(patterns: string[], exclude: string[] = []): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const file of globSync(pattern, { cwd: PANEL, exclude: (f) => f === "node_modules" })) files.add(file);
  }
  const excluded = new Set(exclude.flatMap((p) => globSync(p, { cwd: PANEL, exclude: (f) => f === "node_modules" })));
  return [...files].filter((f) => !excluded.has(f)).sort();
}

const slowFiles = () => expand(SLOW_INCLUDE);

function slowPattern(): RegExp {
  const hook = readFileSync(join(PANEL, ".husky/pre-push"), "utf8");
  const m = hook.match(/^SLOW='([^']+)'$/m);
  if (!m) throw new Error("pre-push defines no SLOW='…' subject pattern");
  return new RegExp(m[1]);
}

describe("test projects", () => {
  it("node-slow include is exactly the allowlisted process-driving suites", () => {
    const slow = project("node-slow");
    expect(slow.include).toEqual(SLOW_INCLUDE);
    expect(slow.sequence?.groupOrder).toBe(2);
    expect(slow.fileParallelism).toBe(false);
    expect(slow.testTimeout).toBe(120_000);
    // default pool (forks): these suites chdir, mutate env and spawn children
    expect(slow.pool).toBeUndefined();
    expect(slowFiles()).toHaveLength(13);
  });

  it("the node project excludes every node-slow suite", () => {
    const node = project("node");
    const browser = project("browser");
    const fast = [
      ...expand(node.include ?? [], node.exclude ?? []),
      ...expand(browser.include ?? [], browser.exclude ?? []),
    ];
    for (const file of slowFiles()) expect(fast).not.toContain(file);
    // excluding the slow suites must not drop the defaults (node_modules, dist)
    expect(node.exclude).toEqual(expect.arrayContaining(["**/node_modules/**"]));
  });

  it("no fast-run test carries a per-test timeout of a second or more", () => {
    const node = project("node");
    const browser = project("browser");
    const fast = [
      ...expand(node.include ?? [], node.exclude ?? []),
      ...expand(browser.include ?? [], browser.exclude ?? []),
    ];
    expect(fast.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of fast) {
      readFileSync(join(PANEL, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          // `}, 30_000);` or `}, { timeout: 30_000 });` closing an it/test,
          // or `it("…", { timeout: 30_000 }, …)`
          const closing = line.match(/^\s*\},\s*(?:\{\s*timeout:\s*)?([\d_]+)(?:\s*\})?\);?\s*$/);
          const options = line.match(/^\s*(?:it|test)(?:\.\w+)*\(.*\{\s*timeout:\s*([\d_]+)/);
          const ms = Number((closing?.[1] ?? options?.[1] ?? "0").replace(/_/g, ""));
          if (ms >= 1000) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the pre-push subject pattern matches every node-slow suite", () => {
    const slow = slowPattern();
    const missed = slowFiles().filter((f) => !slow.test(`panel/${f}`));
    expect(missed).toEqual([]);
    // and the root launchers those suites execute, extensionless ones included
    for (const subject of ["scripts/update.sh", "scripts/pm", "scripts/panel", "scripts/setup:codex", "scripts/setup:shortcut"]) {
      expect(slow.test(subject), subject).toBe(true);
    }
  });

  it("the pre-push subject pattern ignores src-only changes", () => {
    const slow = slowPattern();
    const src = expand(["src/**/*"]);
    expect(src.length).toBeGreaterThan(100);
    const hits = src.filter((f) => slow.test(`panel/${f}`));
    expect(hits).toEqual([]);
  });
});
