import { beforeEach, describe, expect, it } from "vitest";
import {
  readLastPath,
  writeLastPath,
  readLastReposQuery,
  writeLastReposQuery,
  clearLastReposQuery,
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
