import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { createTsNav, repoTypeScriptPath, type TsNav } from "../ts-nav";

const REPO = join(__dirname, "fixtures", "ts-repo");
const SOLUTION = join(__dirname, "fixtures", "ts-solution");
const MONO = join(__dirname, "fixtures", "ts-mono");

/** The panel's TypeScript with `createLanguageService` spied on, so tests can count and break services. */
function spiedTs() {
  const wrapped = Object.create(ts) as typeof ts;
  const disposed: number[] = [];
  const create = vi.fn((...args: Parameters<typeof ts.createLanguageService>) => {
    const svc = ts.createLanguageService(...args);
    const n = create.mock.calls.length;
    const dispose = svc.dispose.bind(svc);
    svc.dispose = () => {
      disposed.push(n);
      dispose();
    };
    return svc;
  });
  // The module's exports are getters, so shadow rather than assign.
  Object.defineProperty(wrapped, "createLanguageService", { value: create });
  return { wrapped, create, disposed };
}

let nav: TsNav | undefined;
let tmp = "";
afterEach(() => {
  nav?.dispose();
  nav = undefined;
  vi.useRealTimers();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

const COMPILER = { target: "ES2020", module: "ESNext", moduleResolution: "bundler", noEmit: true };

/** A temp repo holding `files` (objects are written as JSON); returns its realpath. */
function tempRepo(files: Record<string, string | object>): string {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "ts-nav-")));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(tmp, p)), { recursive: true });
    writeFileSync(join(tmp, p), typeof c === "string" ? c : JSON.stringify(c));
  }
  return tmp;
}

describe("ts-nav", () => {
  it("resolves an imported function across files", async () => {
    nav = createTsNav();
    // `area` in `export const total = area(square);`
    expect(await nav.definition(REPO, "src/main.ts", 5, 22)).toEqual([{ path: "src/shapes.ts", line: 6, col: 17 }]);
  });

  it("resolves a type reference to its interface", async () => {
    nav = createTsNav();
    // `Shape` in `export const square: Shape = ...`
    expect(await nav.definition(REPO, "src/main.ts", 3, 22)).toEqual([{ path: "src/shapes.ts", line: 1, col: 18 }]);
  });

  it("resolves a relative import specifier to the imported file's first line", async () => {
    nav = createTsNav();
    // Inside `"./shapes"` in `import { area, type Shape } from "./shapes";`
    expect(await nav.definition(REPO, "src/main.ts", 1, 38)).toEqual([{ path: "src/shapes.ts", line: 1, col: 1 }]);
  });

  it("resolves export-from, dynamic import and require specifiers, and an index file", async () => {
    nav = createTsNav();
    const root = tempRepo({
      "tsconfig.json": { compilerOptions: { ...COMPILER, allowJs: true }, include: ["src"] },
      "src/lib/index.ts": "export const x = 1;\n",
      "src/a.ts": 'export { x } from "./lib";\nexport const later = () => import("./lib");\n',
      "src/c.js": 'const lib = require("./lib");\n',
    });
    const at = { path: "src/lib/index.ts", line: 1, col: 1 };
    expect(await nav.definition(root, "src/a.ts", 1, 21)).toEqual([at]);
    expect(await nav.definition(root, "src/a.ts", 2, 37)).toEqual([at]);
    expect(await nav.definition(root, "src/c.js", 1, 23)).toEqual([at]);
  });

  it("an unresolvable specifier has no definition", async () => {
    nav = createTsNav();
    const root = tempRepo({
      "tsconfig.json": { compilerOptions: COMPILER, include: ["src"] },
      "src/a.ts": 'import { y } from "./nope";\n',
    });
    expect(await nav.definition(root, "src/a.ts", 1, 22)).toEqual([]);
  });

  it("returns no locations for whitespace", async () => {
    nav = createTsNav();
    expect(await nav.definition(REPO, "src/main.ts", 3, 21)).toEqual([]);
  });

  it("disposes an idle service after ten minutes", async () => {
    vi.useFakeTimers();
    const { wrapped, create } = spiedTs();
    nav = createTsNav({ loadTypeScript: () => wrapped });
    await nav.definition(REPO, "src/main.ts", 5, 22);
    vi.advanceTimersByTime(9 * 60_000);
    await nav.definition(REPO, "src/main.ts", 5, 22);
    expect(create).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(nav.activeRoots()).toEqual([]);
    expect(await nav.definition(REPO, "src/main.ts", 5, 22)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("recreates the service after a crash", async () => {
    const { wrapped, create } = spiedTs();
    create.mockImplementationOnce((...args) => {
      const svc = ts.createLanguageService(...args);
      svc.getDefinitionAtPosition = () => {
        throw new Error("boom");
      };
      return svc;
    });
    nav = createTsNav({ loadTypeScript: () => wrapped });
    expect(await nav.definition(REPO, "src/main.ts", 5, 22)).toEqual([]);
    expect(nav.activeRoots()).toEqual([]);
    expect(await nav.definition(REPO, "src/main.ts", 5, 22)).toEqual([{ path: "src/shapes.ts", line: 6, col: 17 }]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("skips non-TypeScript files without starting a service", async () => {
    const load = vi.fn(() => ts);
    nav = createTsNav({ loadTypeScript: load });
    expect(await nav.definition(REPO, "tsconfig.json", 1, 1)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(nav.activeRoots()).toEqual([]);
  });

  it("resolves a paths alias in a jsx file through a solution-style tsconfig", async () => {
    nav = createTsNav();
    // `greet` in `export const App = () => <p>{greet("you")}</p>;`, aliased as `@/lib/greet` by tsconfig.app.json
    expect(await nav.definition(SOLUTION, "src/App.tsx", 3, 30)).toEqual([{ path: "src/lib/greet.ts", line: 1, col: 17 }]);
  });

  it("keeps one service per tsconfig when alternating between packages", async () => {
    const { wrapped, create } = spiedTs();
    nav = createTsNav({ loadTypeScript: () => wrapped });
    for (const p of ["a", "b", "a", "b"]) await nav.definition(MONO, `packages/${p}/src/index.ts`, 2, 21);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("caps live services at three, disposing the least recently used", async () => {
    const { wrapped, create, disposed } = spiedTs();
    nav = createTsNav({ loadTypeScript: () => wrapped });
    const at = (p: string) => nav!.definition(MONO, `packages/${p}/src/index.ts`, 2, 21);
    await at("a");
    await at("b");
    await at("c");
    // `a` becomes the most recent, so `b` is the oldest when `d` arrives.
    expect(await at("a")).toEqual([{ path: "packages/a/src/index.ts", line: 1, col: 14 }]);
    await at("d");
    expect(disposed).toEqual([2]);
    await at("a");
    await at("c");
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("follows a tsconfig paths edit on the next request", async () => {
    const root = tempRepo({
      "tsconfig.json": { compilerOptions: { ...COMPILER, paths: { "@x": ["./src/one.ts"] } }, include: ["src"] },
      "src/one.ts": "export const v = 1;\n",
      "src/two.ts": "export const v = 2;\n",
      "src/main.ts": 'import { v } from "@x";\nexport const w = v;\n',
    });
    nav = createTsNav();
    expect(await nav.definition(root, "src/main.ts", 2, 18)).toEqual([{ path: "src/one.ts", line: 1, col: 14 }]);
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { ...COMPILER, paths: { "@x": ["./src/two.ts"] } }, include: ["src"] }),
    );
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(root, "tsconfig.json"), later, later);
    expect(await nav.definition(root, "src/main.ts", 2, 18)).toEqual([{ path: "src/two.ts", line: 1, col: 14 }]);
  });

  it("serves a file from the ancestor tsconfig that includes it, past a nearer one that does not", async () => {
    const root = tempRepo({
      "tsconfig.json": { compilerOptions: { ...COMPILER, paths: { "@t/*": ["./packages/p/testlib/*"] } }, include: ["packages/p/test"] },
      "packages/p/tsconfig.json": { compilerOptions: COMPILER, include: ["src"] },
      "packages/p/src/index.ts": "export const s = 1;\n",
      "packages/p/testlib/h.ts": "export const h = 1;\n",
      "packages/p/test/x.test.ts": 'import { h } from "@t/h";\nexport const y = h;\n',
    });
    nav = createTsNav();
    expect(await nav.definition(root, "packages/p/test/x.test.ts", 2, 18)).toEqual([
      { path: "packages/p/testlib/h.ts", line: 1, col: 14 },
    ]);
  });

  it("jumps into an unbuilt referenced project through its sources", async () => {
    const root = tempRepo({
      "packages/a/tsconfig.json": {
        compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler", composite: true, outDir: "dist", rootDir: "src" },
        include: ["src"],
      },
      "packages/a/src/index.ts": "export const fromA = 1;\n",
      "packages/b/tsconfig.json": {
        compilerOptions: { ...COMPILER, paths: { "@a": ["../a/dist/index"] } },
        references: [{ path: "../a" }],
        include: ["src"],
      },
      "packages/b/src/index.ts": 'import { fromA } from "@a";\nexport const z = fromA;\n',
    });
    nav = createTsNav();
    expect(await nav.definition(root, "packages/b/src/index.ts", 2, 18)).toEqual([
      { path: "packages/a/src/index.ts", line: 1, col: 14 },
    ]);
  });

  it("finds a workspace package's own TypeScript and drops it from the module cache with its service", async () => {
    const panelTs = createRequire(import.meta.url).resolve("typescript");
    const root = tempRepo({
      "packages/p/node_modules/typescript/package.json": { name: "typescript", main: "index.js" },
      "packages/p/node_modules/typescript/index.js": `module.exports = require(${JSON.stringify(panelTs)});\n`,
      "packages/p/tsconfig.json": { compilerOptions: COMPILER, include: ["src"] },
      "packages/p/src/index.ts": "export const base = 1;\nexport const next = base + 1;\n",
    });
    const own = join(root, "packages/p/node_modules/typescript/index.js");
    expect(repoTypeScriptPath(root, join(root, "packages/p/src"))).toBe(own);
    // Outside the package the repo has no TypeScript: the panel's is used.
    expect(repoTypeScriptPath(root, root)).toBeUndefined();

    const load = vi.fn((_root: string, tsPath: string | undefined) => (tsPath ? (require(tsPath) as typeof ts) : ts));
    nav = createTsNav({ loadTypeScript: load });
    expect(await nav.definition(root, "packages/p/src/index.ts", 2, 21)).toHaveLength(1);
    expect(load).toHaveBeenCalledWith(root, own);
    expect(require.cache[own]).toBeDefined();
    nav.dispose();
    expect(require.cache[own]).toBeUndefined();
  });
});
