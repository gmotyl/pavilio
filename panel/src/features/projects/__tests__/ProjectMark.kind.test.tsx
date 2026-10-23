import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { ProjectMark } from "../ProjectMark";

afterEach(() => {
  cleanup();
  localStorage.clear();
  __resetPreferenceStoreForTests();
});

describe("ProjectMark kind", () => {
  it("ProjectMark renders flask for research, book for knowledge, letter otherwise", () => {
    // A stored mark must not override the kind mark: the kind is what the row is.
    render(<ProjectMark project="lab" kind="research" mark="lucide:rocket" />);
    expect(screen.getByTestId("project-mark-icon-flask").getAttribute("class")).toContain(
      "lucide-flask",
    );
    expect(screen.queryByTestId("project-mark-icon-rocket")).toBeNull();
    cleanup();

    render(<ProjectMark project="knowledge" kind="knowledge" />);
    expect(screen.getByTestId("project-mark-icon-book").getAttribute("class")).toContain(
      "lucide-book",
    );
    cleanup();

    // `project` and an absent kind both draw the project's own mark, as before.
    render(<ProjectMark project="alpha" kind="project" mark="lucide:rocket" />);
    expect(screen.getByTestId("project-mark-icon-rocket")).toBeTruthy();
    cleanup();

    render(<ProjectMark project="alpha" mark="lucide:rocket" />);
    expect(screen.getByTestId("project-mark-icon-rocket")).toBeTruthy();
  });

  it("a stored projectMark preference loses to kind=research", () => {
    // No `mark` prop: the stored preference is the mark the row would draw.
    writePreference(preferences.projectMark, "lucide:rocket", "lab");
    render(<ProjectMark project="lab" kind="research" />);
    expect(screen.getByTestId("project-mark-icon-flask")).toBeTruthy();
    expect(screen.queryByTestId("project-mark-icon-rocket")).toBeNull();
    cleanup();

    // Control: without the kind the stored mark is what draws.
    render(<ProjectMark project="lab" />);
    expect(screen.getByTestId("project-mark-icon-rocket")).toBeTruthy();
  });
});
