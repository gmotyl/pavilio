import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useProjectTabs } from "../useProjectTabs";
import { SPECIAL_SECTIONS } from "../sections";
import { writeLastReposQuery, writeLastSectionFile } from "../../shell/lastPath";

const PROJECT = "pavilio";

const tabsFor = (opts: { section?: string; hasWiki?: boolean } = {}) =>
  renderHook(() =>
    useProjectTabs({
      projectName: PROJECT,
      section: opts.section,
      hasRepos: false,
      hasWiki: opts.hasWiki,
    }),
  ).result.current.tabs;

beforeEach(() => {
  sessionStorage.clear();
});

describe("the wiki tab", () => {
  it("shows the wiki tab after context only with a wiki", () => {
    const withWiki = tabsFor({ hasWiki: true }).map((t) => t.label);
    expect(withWiki).toEqual([
      "iterm",
      "Overview",
      "plans",
      "context",
      "wiki",
      "notes",
      "memo",
      "progress",
      "mockups",
      "qa",
    ]);
    expect(withWiki.indexOf("wiki")).toBe(withWiki.indexOf("context") + 1);

    // No wiki: no tab, and the rest are unchanged.
    const withoutWiki = tabsFor({ hasWiki: false }).map((t) => t.label);
    expect(withoutWiki).not.toContain("wiki");
    expect(withoutWiki).toEqual(withWiki.filter((l) => l !== "wiki"));
    expect(tabsFor().map((t) => t.label)).toEqual(withoutWiki);
  });

  it("restores the last wiki page in the tab link", () => {
    writeLastSectionFile(PROJECT, "wiki", "pavilio/wiki/concepts/utterance.md");
    const wiki = tabsFor({ hasWiki: true }).find((t) => t.label === "wiki");
    expect(wiki?.to).toBe(
      "/project/pavilio/wiki?file=pavilio%2Fwiki%2Fconcepts%2Futterance.md",
    );
  });

  it("is a special section with its own surface", () => {
    expect(SPECIAL_SECTIONS.has("wiki")).toBe(true);
    const wiki = tabsFor({ section: "wiki", hasWiki: true }).find((t) => t.label === "wiki");
    expect(wiki?.active).toBe(true);
  });
});

describe("tab order and the Code label", () => {
  const withRepos = (archived = false) =>
    renderHook(() =>
      useProjectTabs({ projectName: PROJECT, section: undefined, hasRepos: true, archived }),
    ).result.current.tabs;

  it("qa is the last tab with and without repos", () => {
    expect(withRepos().map((t) => t.label).slice(-3)).toEqual(["mockups", "Code", "qa"]);
    expect(tabsFor().map((t) => t.label).slice(-2)).toEqual(["mockups", "qa"]);
  });

  it("repos tab is labelled Code and still routes to /repos", () => {
    const labels = withRepos().map((t) => t.label);
    expect(labels).not.toContain("repos");
    expect(withRepos().find((t) => t.label === "Code")?.to).toBe("/project/pavilio/repos");

    writeLastReposQuery(PROJECT, "view=prs");
    expect(withRepos().find((t) => t.label === "Code")?.to).toBe("/project/pavilio/repos?view=prs");
  });

  it("archived project ends with mockups then qa", () => {
    expect(withRepos(true).map((t) => t.label).slice(-2)).toEqual(["mockups", "qa"]);
  });
});

describe("an archived project's tabs", () => {
  it("archived project tabs omit iterm and repos", () => {
    const labels = renderHook(() =>
      useProjectTabs({
        projectName: PROJECT,
        section: undefined,
        hasRepos: true,
        hasWiki: true,
        archived: true,
      }),
    ).result.current.tabs.map((t) => t.label);
    // Hidden, not disabled: the labels are simply absent.
    expect(labels).toEqual([
      "Overview",
      "plans",
      "context",
      "wiki",
      "notes",
      "memo",
      "progress",
      "mockups",
      "qa",
    ]);
  });
});

