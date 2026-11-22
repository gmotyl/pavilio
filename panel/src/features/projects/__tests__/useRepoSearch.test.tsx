import { describe, it, expect, beforeEach, vi } from "vitest";
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
      { name: "broken", present: true },
      { name: "alpha", path: "/git/alpha", present: true },
    ] as { name: string; path: string; present: boolean }[];

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

/**
 * A linked repo that is not on this machine (`present: false`) has nothing to
 * search: every git call against its path would fail on the server. The hook
 * must skip it outright — and pick it up again once it appears.
 */
describe("useRepoSearch with a linked repo missing on this machine", () => {
  const present = { name: "alpha", path: "/git/alpha", present: true };
  const missing = { name: "ghost", path: "/git/ghost", present: false };

  const urls = (spy: ReturnType<typeof mockFetchResponses>) =>
    spy.mock.calls.map(([input]) => String(input));

  beforeEach(() => {
    writePreference(preferences.branchDiffBase, "main", "/git/alpha");
    writePreference(preferences.branchDiffBase, "main", "/git/ghost");
  });

  it("never fetches a repo that is not on this machine", async () => {
    for (const scope of ["changed", "branch-diff"] as const) {
      doc()[storageKey(preferences.repoSearchScope)] = scope;
      const spy = mockFetchResponses({
        "/api/git/status": [{ status: "M", path: "src/index.ts" }],
        "/api/git/branch-diff-files": {
          files: [{ status: "M", path: "src/index.ts" }],
          commitsAhead: 1,
        },
      });

      const { result, unmount } = renderHook(() =>
        useRepoSearch({ active: true, repos: [present, missing], query: "" }),
      );

      expect(result.current.scope).toBe(scope);
      await waitFor(() => {
        expect(result.current.files).toHaveLength(1);
      });
      expect(result.current.files[0]).toMatchObject({
        repoName: "alpha",
        path: "src/index.ts",
        source: scope,
      });
      // The spy was reached for the present repo, so "no call for the missing
      // one" is not vacuous.
      expect(urls(spy).some((u) => u.includes(encodeURIComponent("/git/alpha")))).toBe(true);
      expect(urls(spy).some((u) => u.includes(encodeURIComponent("/git/ghost")))).toBe(false);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it("re-runs the search when a missing repo becomes present", async () => {
    doc()[storageKey(preferences.repoSearchScope)] = "changed";
    const spy = mockFetchResponses({
      "/api/git/status": [{ status: "M", path: "src/index.ts" }],
    });

    const { result, rerender } = renderHook(
      ({ repos }) => useRepoSearch({ active: true, repos, query: "" }),
      { initialProps: { repos: [present, missing] } },
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });
    expect(urls(spy).some((u) => u.includes(encodeURIComponent("/git/ghost")))).toBe(false);

    rerender({ repos: [present, { ...missing, present: true }] });

    await waitFor(() => {
      expect(result.current.files).toHaveLength(2);
    });
    expect(urls(spy).some((u) => u.includes(encodeURIComponent("/git/ghost")))).toBe(true);
    expect(result.current.files.map((f) => f.repoName).sort()).toEqual([
      "alpha",
      "ghost",
    ]);
  });
});
