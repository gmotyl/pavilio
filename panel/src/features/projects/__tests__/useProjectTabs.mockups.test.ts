import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useProjectTabs } from "../useProjectTabs";
import { SPECIAL_SECTIONS } from "../sections";
import { writeLastSectionFile } from "../../shell/lastPath";

const PROJECT = "pavilio";

const tabsFor = (section?: string) =>
  renderHook(() =>
    useProjectTabs({ projectName: PROJECT, section, hasRepos: false }),
  ).result.current.tabs;

beforeEach(() => {
  sessionStorage.clear();
});

describe("the mockups tab", () => {
  it("lists a mockups tab for a project with no mockups folder", () => {
    // The tab is unconditional: the folder is created by writing the first
    // mockup, so a project without one still needs somewhere to look.
    expect(tabsFor().map((t) => t.label)).toContain("mockups");
  });

  it("places mockups after qa without reordering the existing tabs", () => {
    expect(tabsFor().map((t) => t.label)).toEqual([
      "iterm",
      "Overview",
      "plans",
      "context",
      "notes",
      "memo",
      "progress",
      "qa",
      "mockups",
    ]);
  });

  it("carries the remembered file into the mockups tab link", () => {
    writeLastSectionFile(PROJECT, "mockups", "pavilio/mockups/boot legend.html");

    const mockups = tabsFor().find((t) => t.label === "mockups");
    expect(mockups?.to).toBe(
      "/project/pavilio/mockups?file=pavilio%2Fmockups%2Fboot%20legend.html",
    );
  });

  it("is not a special section", () => {
    // Staying out of the set is what routes `mockups` down the generic
    // file-list + inline viewer path instead of a bespoke surface.
    expect(SPECIAL_SECTIONS.has("mockups")).toBe(false);

    const mockups = tabsFor("mockups").find((t) => t.label === "mockups");
    expect(mockups?.active).toBe(true);
  });
});
