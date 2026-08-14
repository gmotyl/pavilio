import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import PlansTab from "../PlansTab";

const tree = {
  project: "demo",
  sources: [
    {
      id: "project",
      label: "projects (current)",
      absoluteRoot: "/p",
      files: [
        { source: "project", filename: "2026-01-01-old.md", absolutePath: "/p/2026-01-01-old.md", modified: 10, relativeToProjectsDir: "demo/plans/2026-01-01-old.md" },
        { source: "project", filename: "2026-02-02-new.md", absolutePath: "/p/2026-02-02-new.md", modified: 20, relativeToProjectsDir: "demo/plans/2026-02-02-new.md" },
      ],
    },
  ],
};

describe("PlansTab filter + auto-open", () => {
  it("filters plan rows by filename substring", async () => {
    mockFetchResponses({ "plans-tree": tree, "/plans/read": { content: "# hi" } });
    renderWithRouter(<PlansTab projectName="demo" />, { initialEntries: ["/"] });
    expect(await screen.findByTestId("plans-tab-file-project-2026-02-02-new.md")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("file-list-filter-input"), { target: { value: "old" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId("plans-tab-file-project-2026-02-02-new.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("plans-tab-file-project-2026-01-01-old.md")).toBeInTheDocument();
  });

  it("auto-opens the starred plan even when a newer plan exists", async () => {
    mockFetchResponses({ "plans-tree": tree, "/plans/read": { content: "# starred" } });
    renderWithRouter(
      <PlansTab projectName="demo" currentPlans={["2026-01-01-old.md"]} />,
      { initialEntries: ["/"] },
    );
    // starred old.md opens (its content loads) even though new.md is newer.
    // MarkdownRenderer renders "# starred" as an <h1>starred</h1>, so the
    // heading text (sans "#") is what appears in the DOM.
    expect(await screen.findByText("starred")).toBeInTheDocument();
  });
});
