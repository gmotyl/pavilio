import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { join } from "path";
import { createTsNav, type TsNav } from "../ts-nav";

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
afterEach(() => {
  nav?.dispose();
  nav = undefined;
  vi.useRealTimers();
});

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
});
