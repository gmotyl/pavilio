import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubFetch } from "../../test-utils";
import { preferences } from "../declarations";
import { __resetPreferenceStoreForTests, readPreference, writePreference } from "../store";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  stubFetch({}, { ok: true });
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
});

describe("repos preferences", () => {
  it("repos preferences are scoped per project", () => {
    const { reposView, reposPrFilter } = preferences;
    expect(reposView.scope).toBe("project");
    expect(reposPrFilter.scope).toBe("project");
    expect(preferences.fileViewerDiffLayout.scope).toBe("global");

    writePreference(reposPrFilter, { preset: "mine", author: "gmotyl" }, "pavilio");
    writePreference(reposView, "prs", "pavilio");

    expect(readPreference(reposPrFilter, "pavilio")).toEqual({ preset: "mine", author: "gmotyl" });
    expect(readPreference(reposPrFilter, "vector")).toEqual({ preset: "review", author: null });
    expect(readPreference(reposView, "pavilio")).toBe("prs");
    expect(readPreference(reposView, "vector")).toBe("code");
  });

  it("malformed repos preferences fall back to defaults", () => {
    const { reposView, reposPrFilter, fileViewerDiffLayout } = preferences;
    const junkFilters: unknown[] = [
      "not json",
      42,
      null,
      [],
      { preset: "everyone", author: null },
      { preset: "mine", author: 7 },
      { preset: "mine" },
    ];
    for (const junk of junkFilters) {
      globals.__PAVILIO_PREFS__ = {
        version: 1,
        "repos.view@pavilio": "sideways",
        "repos.prFilter@pavilio": junk,
        "fileViewer.diffLayout": "stacked",
      };
      __resetPreferenceStoreForTests();
      expect(readPreference(reposPrFilter, "pavilio"), JSON.stringify(junk)).toEqual({
        preset: "review",
        author: null,
      });
    }
    expect(readPreference(reposView, "pavilio")).toBe("code");
    expect(readPreference(fileViewerDiffLayout)).toBe("split");
  });
});
