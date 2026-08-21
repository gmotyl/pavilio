import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
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
    {
      id: "openspec:project",
      label: "demo (OpenSpec)",
      kind: "openspec",
      mode: "store",
      openspecDir: "/p/openspec",
      changes: [
        {
          changeId: "add-checkout-tax",
          source: "openspec:project",
          status: "active",
          archiveDate: null,
          artifacts: [
            {
              kind: "spec",
              capability: "checkout",
              filename: "spec.md",
              absolutePath: "/p/openspec/changes/add-checkout-tax/specs/checkout/spec.md",
              modified: 5,
              relativeToProjectsDir: null,
            },
          ],
        },
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
    // The query is debounced; poll until the filter settles instead of racing a
    // fixed delay (which also lets debounce/auto-select state updates run in act).
    await waitFor(() =>
      expect(screen.queryByTestId("plans-tab-file-project-2026-02-02-new.md")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("plans-tab-file-project-2026-01-01-old.md")).toBeInTheDocument();
  });

  it("filters OpenSpec artifacts by capability", async () => {
    mockFetchResponses({ "plans-tree": tree, "/plans/read": { content: "# hi" } });
    renderWithRouter(<PlansTab projectName="demo" />, { initialEntries: ["/"] });
    expect(
      await screen.findByTestId(
        "plans-tab-artifact-openspec:project-add-checkout-tax-spec-checkout",
      ),
    ).toBeInTheDocument();
    // A capability-name query keeps the matching artifact and drops legacy files.
    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "checkout" },
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("plans-tab-file-project-2026-02-02-new.md"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(
        "plans-tab-artifact-openspec:project-add-checkout-tax-spec-checkout",
      ),
    ).toBeInTheDocument();
  });
});
