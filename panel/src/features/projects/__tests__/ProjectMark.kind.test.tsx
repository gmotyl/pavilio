import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { __resetPreferenceStoreForTests } from "../../../preferences/store";
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
});
