import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectTabsBar, ProjectTabsMenu } from "../ProjectTabs";
import { REPOS_LABEL, type ProjectTab } from "../useProjectTabs";

const TABS: ProjectTab[] = [
  { label: "Overview", to: "/p/demo", active: true },
  { label: REPOS_LABEL, to: "/p/demo/repos", active: false },
  { label: "qa", to: "/p/demo/qa", active: false },
];

/** The links' own text, as a reader sees it before CSS `capitalize`. */
function linkTexts(): string[] {
  return screen.getAllByRole("link", { hidden: true }).map((a) => a.textContent ?? "");
}

describe("project tab labels", () => {
  it("the tab bar shows QA and Code", () => {
    render(
      <MemoryRouter>
        <ProjectTabsBar tabs={TABS} onToggleSearch={() => {}} />
      </MemoryRouter>,
    );
    expect(linkTexts()).toEqual(expect.arrayContaining(["QA", "Code"]));
  });

  it("the tab menu shows QA and Code", () => {
    render(
      <MemoryRouter>
        <ProjectTabsMenu tabs={TABS} activeTab={TABS[2]!} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("project-tabs-menu-toggle").textContent).toBe("QA");
    fireEvent.click(screen.getByTestId("project-tabs-menu-toggle"));
    expect(linkTexts()).toEqual(expect.arrayContaining(["QA", "Code"]));
  });
});
