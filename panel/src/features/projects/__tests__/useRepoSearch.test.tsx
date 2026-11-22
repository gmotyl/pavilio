import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRepoSearch } from "../useRepoSearch";
import { mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

/**
 * The repo search reads every repository's stored branch-diff base before it
 * fetches. `server/lib/discovery.ts` now skips `repos.json` entries without a
 * string `path`, so this fixture is synthetic: the hook's guard is defensive
 * against unvalidated input that hands it `{ name, path: undefined }`.
 *
 * That read sits inside a `Promise.all`, exactly where the old
 * `localStorage.getItem` sat. A guard spelt `repo.path.trim() !== ""` would
 * therefore throw on the malformed entry, rejects the whole `Promise.all`, and
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

/**
 * A repo that goes missing while results are on screen: its files and matches
 * must vanish at once — not when the surviving repos' refetch lands — and no
 * later request may name its path.
 */
describe("useRepoSearch when a linked repo goes missing mid-session", () => {
  const alpha = { name: "alpha", path: "/git/alpha", present: true };
  const beta = { name: "beta", path: "/git/beta", present: true };

  const repoOf = (url: string) =>
    decodeURIComponent(new URL(url, "http://x").searchParams.get("repo") ?? "");
  const ok = (data: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
  const never = () => new Promise<Response>(() => {});

  /** A fetch stub whose per-URL answer can be swapped (or held) mid-test. */
  function stubFetch(answer: (url: string) => Promise<Response>) {
    const state = { answer };
    const spy = vi.fn((input: string | URL | Request) =>
      state.answer(String(input)),
    );
    vi.stubGlobal("fetch", spy);
    return { spy, state };
  }

  const fileFor = (repo: string) => `${repo.split("/").pop()}.ts`;
  const healthy = (url: string) => {
    const repo = repoOf(url);
    if (url.includes("/api/git/status")) {
      return ok([{ status: "M", path: fileFor(repo) }]);
    }
    if (url.includes("/api/git/grep")) {
      // The real `/api/git/grep` shape: `project` is always "" (the hook must
      // assign the owner repo itself) and only files with a match get a row.
      const files = (new URL(url, "http://x").searchParams.get("files") ?? "")
        .split(",")
        .filter(Boolean);
      return ok(
        files.map((f) => ({
          relativePath: f,
          project: "",
          matches: [{ line: 1, text: `match in ${f}` }],
        })),
      );
    }
    return ok([]);
  };
  const grepCalls = (spy: ReturnType<typeof stubFetch>["spy"], from = 0) =>
    spy.mock.calls
      .slice(from)
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/git/grep"));

  beforeEach(() => {
    vi.unstubAllGlobals();
    doc()[storageKey(preferences.repoSearchScope)] = "changed";
  });

  it("drops a repo's results as soon as it goes missing", async () => {
    const { spy, state } = stubFetch(healthy);
    const { result, rerender } = renderHook(
      ({ repos, query }) => useRepoSearch({ active: true, repos, query }),
      { initialProps: { repos: [alpha, beta], query: "ts" } },
    );

    await waitFor(() => {
      expect(result.current.files).toHaveLength(2);
      expect(result.current.grepResults).toHaveLength(2);
    });
    expect(grepCalls(spy).some((u) => repoOf(u) === "/git/beta")).toBe(true);
    // The hook, not the server, names each match's repo.
    expect(result.current.grepResults.map((r) => r.project).sort()).toEqual([
      "/git/alpha",
      "/git/beta",
    ]);

    // Hold the surviving repo's refetch so nothing can land and overwrite state.
    state.answer = (url) => (url.includes("/api/git/status") ? never() : healthy(url));
    const callsBefore = spy.mock.calls.length;
    rerender({ repos: [alpha, { ...beta, present: false }], query: "ts" });

    expect(result.current.files.map((f) => f.repo)).toEqual(["/git/alpha"]);
    expect(result.current.grepResults.map((r) => r.project)).toEqual(["/git/alpha"]);

    // A fresh grep while the refetch is still held: it must run (so the next
    // assertion is not vacuous) and must name only the surviving repo.
    rerender({ repos: [alpha, { ...beta, present: false }], query: "tsx" });
    await waitFor(() => {
      expect(
        grepCalls(spy, callsBefore).some(
          (u) => repoOf(u) === "/git/alpha" && u.includes("q=tsx"),
        ),
      ).toBe(true);
    });
    const after = spy.mock.calls.slice(callsBefore).map(([u]) => String(u));
    expect(after.some((u) => u.includes("/api/git/status"))).toBe(true);
    expect(grepCalls(spy, callsBefore).some((u) => repoOf(u) === "/git/beta")).toBe(false);
    expect(after.some((u) => repoOf(u) === "/git/beta")).toBe(false);
    expect(result.current.files.map((f) => f.repo)).toEqual(["/git/alpha"]);
  });

  it("restoring a repo keeps existing matches and does not re-grep unchanged files", async () => {
    const { spy, state } = stubFetch(healthy);
    const { result, rerender } = renderHook(
      ({ repos }) => useRepoSearch({ active: true, repos, query: "ts" }),
      { initialProps: { repos: [alpha, { ...beta, present: false }] } },
    );
    await waitFor(() => {
      expect(result.current.grepResults.map((r) => r.project)).toEqual(["/git/alpha"]);
      expect(result.current.grepLoading).toBe(false);
    });
    const alphaMatches = result.current.grepResults;

    // Hold the file-list refresh past the grep debounce.
    const held: Array<() => void> = [];
    state.answer = (url) =>
      url.includes("/api/git/status")
        ? new Promise<Response>((done) => held.push(() => done(healthy(url) as never)))
        : healthy(url);
    const callsBefore = spy.mock.calls.length;
    rerender({ repos: [alpha, beta] });

    // Beta is present but has contributed no files yet: alpha's search stands.
    expect(result.current.grepLoading).toBe(false);
    expect(result.current.grepResults).toEqual(alphaMatches);
    await new Promise((r) => setTimeout(r, 400));
    expect(held.length).toBe(2); // both refetches were requested and are held
    expect(grepCalls(spy, callsBefore)).toEqual([]);
    expect(result.current.grepLoading).toBe(false);
    expect(result.current.grepResults).toEqual(alphaMatches);

    // Once beta's files land, one grep per repo covers the new file set.
    held.forEach((release) => release());
    await waitFor(() => {
      expect(result.current.grepResults.map((r) => r.project).sort()).toEqual([
        "/git/alpha",
        "/git/beta",
      ]);
    });
    const greps = grepCalls(spy, callsBefore);
    expect(greps.filter((u) => repoOf(u) === "/git/alpha")).toHaveLength(1);
    expect(greps.filter((u) => repoOf(u) === "/git/beta")).toHaveLength(1);
  });

  it("does not fan out commit files for a repo that went missing", async () => {
    doc()[storageKey(preferences.repoSearchScope)] = "commits";
    let releaseLog: () => void = () => {};
    const { spy } = stubFetch((url) => {
      if (url.includes("/api/git/log") && repoOf(url) === "/git/beta") {
        return new Promise<Response>((done) => {
          releaseLog = () =>
            done({ ok: true, json: () => Promise.resolve([{ sha: "abc", message: "m" }]) } as Response);
        });
      }
      if (url.includes("/api/git/log")) return ok([{ sha: "def", message: "m" }]);
      if (url.includes("/api/git/commit-files")) return ok([{ status: "M", path: "x.ts" }]);
      return ok([]);
    });
    const { rerender } = renderHook(
      ({ repos }) => useRepoSearch({ active: true, repos, query: "" }),
      { initialProps: { repos: [alpha, beta] } },
    );
    await waitFor(() => {
      expect(spy.mock.calls.some(([u]) => String(u).includes("/api/git/log") && repoOf(String(u)) === "/git/beta")).toBe(true);
    });

    rerender({ repos: [alpha, { ...beta, present: false }] });
    releaseLog();
    await new Promise((r) => setTimeout(r, 50));

    const commitFiles = spy.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/api/git/commit-files"));
    expect(commitFiles.some((u) => repoOf(u) === "/git/alpha")).toBe(true);
    expect(commitFiles.some((u) => repoOf(u) === "/git/beta")).toBe(false);
  });

  it("stops the search indicator when the last repo goes missing", async () => {
    const { spy, state } = stubFetch(healthy);
    const { result, rerender } = renderHook(
      ({ repos, query }) => useRepoSearch({ active: true, repos, query }),
      { initialProps: { repos: [alpha], query: "ts" } },
    );

    // A first grep lands matches on screen.
    await waitFor(() => {
      expect(result.current.grepResults.map((r) => r.project)).toEqual(["/git/alpha"]);
      expect(result.current.grepLoading).toBe(false);
    });

    // A second grep is held in flight.
    state.answer = (url) => (url.includes("/api/git/grep") ? never() : healthy(url));
    const callsBefore = spy.mock.calls.length;
    rerender({ repos: [alpha], query: "tsx" });
    await waitFor(() => {
      expect(grepCalls(spy, callsBefore).some((u) => u.includes("q=tsx"))).toBe(true);
    });
    expect(result.current.grepLoading).toBe(true);
    expect(result.current.grepResults).toHaveLength(1);

    rerender({ repos: [{ ...alpha, present: false }], query: "tsx" });

    await waitFor(() => {
      expect(result.current.grepLoading).toBe(false);
    });
    expect(result.current.files).toEqual([]);
    expect(result.current.grepResults).toEqual([]);
  });
});
