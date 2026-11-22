import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { join } from "path";
import { createTsNav, type TsNav } from "../ts-nav";

const REPO = join(__dirname, "fixtures", "ts-repo");

/** The panel's TypeScript with `createLanguageService` spied on, so tests can count and break services. */
function spiedTs() {
  const wrapped = Object.create(ts) as typeof ts;
  const create = vi.fn((...args: Parameters<typeof ts.createLanguageService>) => ts.createLanguageService(...args));
  // The module's exports are getters, so shadow rather than assign.
  Object.defineProperty(wrapped, "createLanguageService", { value: create });
  return { wrapped, create };
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
});
