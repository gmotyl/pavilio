import { beforeEach, describe, expect, it } from "vitest";
import {
  readLastPath,
  writeLastPath,
  readLastReposQuery,
  writeLastReposQuery,
  clearLastReposQuery,
  readLastSectionFile,
  writeLastSectionFile,
  clearLastSectionFile,
} from "../lastPath";
import { preferences } from "../../../preferences/declarations";

/**
 * A browser that refuses storage — quota, private mode, blocked site data — is
 * no longer this module's concern: the migration removed `lastPath.ts`'s own
 * try/catch and relocated that protection into `readPreference` /
 * `writePreference`. The four tests that used to sit here have moved with it,
 * to `preferences/__tests__/store.test.ts` ("the session tier under a browser
 * that refuses storage"), where the code they exercise actually lives.
 *
 * They were also vacuous where they stood. They spied on `Storage.prototype`,
 * but `test-setup.ts` installs a plain object literal as `sessionStorage`,
 * which does not inherit from it — so the spy was never reached, the value was
 * still stored, and both tests passed without exercising anything. The
 * relocated versions spy on the storage INSTANCE and assert the spy was called.
 */

/** A scope that is `string` to the compiler and `undefined` at runtime. */
const UNRESOLVED = undefined as unknown as string;

describe("an unresolved scope does not throw", () => {
  /**
   * `projectScope` and `sectionScope` were two of the last four blank-scope
   * guards in this change still spelt as a bare `.trim()`. Every parameter is
   * typed `string`, so on paper none of this can happen — and it has happened
   * twice already, both times from a `name ?? ""` / `projectName` chain that
   * TypeScript sees as `string` while the runtime value is `undefined`. Once
   * it crashed a render (`GitBranchDiff`), once it silently emptied a result
   * list (`useRepoSearch`).
   *
   * No live bug at these sites: every caller guards with `!project` first.
   * These pin the shape anyway — a third regression costs more than two tests.
   */
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("projectScope: an undefined project reads the default and writes nothing", () => {
    expect(() => writeLastPath(UNRESOLVED, "/project/x/notes")).not.toThrow();
    expect(() => readLastPath(UNRESOLVED)).not.toThrow();
    expect(readLastPath(UNRESOLVED)).toBeNull();
    expect(() => writeLastReposQuery(UNRESOLVED, "q")).not.toThrow();
    expect(() => readLastReposQuery(UNRESOLVED)).not.toThrow();
    // Dropped, not misfiled under a blank key.
    expect(sessionStorage.length).toBe(0);
  });

  it("sectionScope: an undefined section reads the default and writes nothing", () => {
    expect(() => writeLastSectionFile("pavilio", UNRESOLVED, "/abs/a.md")).not.toThrow();
    expect(() => readLastSectionFile("pavilio", UNRESOLVED)).not.toThrow();
    expect(readLastSectionFile("pavilio", UNRESOLVED)).toBeNull();
    expect(() => clearLastSectionFile("pavilio", UNRESOLVED)).not.toThrow();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("lastPath helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("writes the path under the project-scoped key", () => {
    writeLastPath("pavilio", "/project/pavilio/repos?file=a.ts");
    // Still sessionStorage, still one key per project — the declaration's key
    // now, and JSON as every stored preference is.
    expect(sessionStorage.getItem(`${preferences.lastPath.key}@pavilio`)).toBe(
      JSON.stringify("/project/pavilio/repos?file=a.ts"),
    );
  });

  it("reads back what was written", () => {
    writeLastPath("pavilio", "/project/pavilio/notes?note=foo");
    expect(readLastPath("pavilio")).toBe("/project/pavilio/notes?note=foo");
  });

  it("returns null when nothing stored", () => {
    expect(readLastPath("missing")).toBeNull();
  });

});

describe("lastReposQuery helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("writes and reads back the query string", () => {
    writeLastReposQuery(
      "pavilio",
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
    expect(readLastReposQuery("pavilio")).toBe(
      "repo=abc&file=src%2Ffoo.ts&scope=branch-diff",
    );
  });

  it("returns null when nothing stored", () => {
    expect(readLastReposQuery("missing")).toBeNull();
  });

  it("clears the stored query", () => {
    writeLastReposQuery("pavilio", "repo=abc");
    clearLastReposQuery("pavilio");
    expect(readLastReposQuery("pavilio")).toBeNull();
  });
});
