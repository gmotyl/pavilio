import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRepoSearch } from "../useRepoSearch";
import { mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

/**
 * The repo search reads every repository's stored branch-diff base before it
 * fetches, and `server/lib/discovery.ts` ships `repos.json` entries through
 * with no runtime validation — so an entry that never had a `path` reaches this
 * hook as `{ name, path: undefined }`.
 *
 * That read sits inside a `Promise.all` and outside any `try`, exactly where
 * the old `localStorage.getItem` sat. A guard spelt `repo.path.trim() !== ""`
 * therefore throws on the malformed entry, rejects the whole `Promise.all`, and
 * the healthy repositories' results are never set. One bad line in `repos.json`
 * blanks the search for every repo in the project.
 */

const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
    .__PAVILIO_PREFS__!;

describe("useRepoSearch with a malformed repos.json entry", () => {
  beforeEach(() => {
    doc()[storageKey(preferences.repoSearchScope)] = "branch-diff";
    writePreference(preferences.branchDiffBase, "main", "/git/alpha");
    mockFetchResponses({
      "/api/git/branch-diff-files": {
        files: [{ status: "M", path: "src/index.ts" }],
        commitsAhead: 1,
      },
    });
  });

  it("still returns the healthy repository's files", async () => {
    const repos = [
      { name: "broken" },
      { name: "alpha", path: "/git/alpha" },
    ] as { name: string; path: string }[];

    const { result } = renderHook(() =>
      useRepoSearch({ active: true, repos, query: "" }),
    );

    expect(result.current.scope).toBe("branch-diff");
    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });
    expect(result.current.files[0]).toMatchObject({
      repoName: "alpha",
      path: "src/index.ts",
      source: "branch-diff",
    });
  });
});
