import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import PlansTab from "../PlansTab";
import { SORT_STORAGE_KEY } from "../fileListControls";

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

// --- Task 3: the sort control must reach change groups -----------------------

/** One artifact of a change; `modified` is what the Date sort keys on. */
const art = (filename: string, modified: number) => ({
  kind: filename === "design.md" ? "design" : "proposal",
  capability: null,
  filename,
  absolutePath: `/p/${filename}-${modified}`,
  modified,
  relativeToProjectsDir: null,
});

const change = (
  changeId: string,
  source: string,
  status: "active" | "archived",
  artifacts: ReturnType<typeof art>[],
  archiveDate: string | null = null,
) => ({ changeId, source, status, archiveDate, artifacts });

/**
 * Two OpenSpec sources so one change ("multi") spans both. Group mtimes:
 * alpha 300, beta 100, multi max(1, 900) = 900, yankee 4000, zeta 5000.
 * The archived pair is deliberately both alphabetically last AND newest, so a
 * missing band split shows up under name-desc and date-desc alike.
 */
const sortTree = {
  project: "demo",
  sources: [
    {
      id: "project",
      label: "projects (current)",
      absoluteRoot: "/p",
      files: [
        {
          source: "project",
          filename: "2026-01-01-old.md",
          absolutePath: "/p/2026-01-01-old.md",
          modified: 10,
          relativeToProjectsDir: "demo/plans/2026-01-01-old.md",
        },
        {
          source: "project",
          filename: "2026-02-02-new.md",
          absolutePath: "/p/2026-02-02-new.md",
          modified: 20,
          relativeToProjectsDir: "demo/plans/2026-02-02-new.md",
        },
      ],
    },
    {
      id: "openspec:project",
      label: "demo (OpenSpec)",
      kind: "openspec",
      mode: "store",
      openspecDir: "/p/openspec",
      changes: [
        change("alpha", "openspec:project", "active", [art("proposal.md", 300)]),
        // The older half of the multi-source group, listed first on purpose.
        change("multi", "openspec:project", "active", [art("proposal.md", 1)]),
        change("zeta", "openspec:project", "archived", [art("proposal.md", 5000)], "2026-03-03"),
        change("yankee", "openspec:project", "archived", [art("proposal.md", 4000)], "2026-03-02"),
      ],
    },
    {
      id: "openspec:repo:api",
      label: "api (OpenSpec)",
      kind: "openspec",
      mode: "native",
      openspecDir: "/r/api/openspec",
      changes: [
        // The newer half of the multi-source group lives in the second source.
        change("multi", "openspec:repo:api", "active", [art("design.md", 900)]),
        change("beta", "openspec:repo:api", "active", [art("proposal.md", 100)]),
      ],
    },
  ],
};

/** Change-group headers currently rendered, in DOM order, as bare change ids. */
const groupOrder = () =>
  screen
    .queryAllByTestId(/^plans-tab-source-change:/)
    .map((el) => el.getAttribute("data-testid")!.replace("plans-tab-source-change:", ""));

const archivedCheckbox = () =>
  within(screen.getByTestId("plans-tab-archived-toggle")).getByRole(
    "checkbox",
  ) as HTMLInputElement;

const renderSortTree = async () => {
  mockFetchResponses({ "plans-tree": sortTree, "/plans/read": { content: "# hi" } });
  renderWithRouter(<PlansTab projectName="demo" />, { initialEntries: ["/"] });
  await screen.findByTestId("plans-tab-source-change:alpha");
};

describe("PlansTab sort control over change groups", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("sorts change groups by change id when Name is selected", async () => {
    await renderSortTree();
    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    // Stored default is date/desc, so Name starts descending.
    expect(groupOrder()).toEqual(["multi", "beta", "alpha"]);
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(groupOrder()).toEqual(["alpha", "beta", "multi"]);
  });

  it("reverses change group order when the direction is flipped", async () => {
    await renderSortTree();
    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    const before = groupOrder();
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(groupOrder()).toEqual([...before].reverse());
  });

  it("sorts change groups by their newest artifact mtime when Date is selected", async () => {
    await renderSortTree();
    fireEvent.click(screen.getByTestId("file-list-sort-date"));
    // desc: multi 900, alpha 300, beta 100 — not the alphabetical order.
    expect(groupOrder()).toEqual(["multi", "alpha", "beta"]);
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(groupOrder()).toEqual(["beta", "alpha", "multi"]);
  });

  it("keys a multi-source group by the max artifact mtime across all its sources", async () => {
    await renderSortTree();
    fireEvent.click(screen.getByTestId("file-list-sort-date"));
    fireEvent.click(screen.getByTestId("file-list-sort-dir")); // ascending
    // "multi"'s first child holds the oldest artifact in the whole tree
    // (modified 1); keyed on the max (900) it must still sort last.
    expect(groupOrder()).toEqual(["beta", "alpha", "multi"]);
    expect(groupOrder().at(-1)).toBe("multi");
  });

  it("never lifts an archived group above an active one, whatever the sort", async () => {
    await renderSortTree();
    fireEvent.click(archivedCheckbox());
    expect(groupOrder()).toContain("zeta");

    const active = ["alpha", "beta", "multi"];
    const archived = ["yankee", "zeta"];
    const assertBanded = () => {
      const order = groupOrder();
      expect(order).toHaveLength(5);
      const lastActive = Math.max(...active.map((id) => order.indexOf(id)));
      const firstArchived = Math.min(...archived.map((id) => order.indexOf(id)));
      expect(lastActive).toBeLessThan(firstArchived);
    };
    // All four key × direction combinations. zeta/yankee are both the newest
    // and the alphabetically last, so a missing band split surfaces here.
    for (const key of ["name", "date"] as const) {
      fireEvent.click(screen.getByTestId(`file-list-sort-${key}`));
      assertBanded();
      fireEvent.click(screen.getByTestId("file-list-sort-dir"));
      assertBanded();
      fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    }
    // …and the control still orders within the archived band (dir is desc here).
    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    expect(groupOrder().slice(3)).toEqual(["zeta", "yankee"]);
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(groupOrder().slice(3)).toEqual(["yankee", "zeta"]);
  });

  it("still sorts legacy flat files and persists the sort preference", async () => {
    await renderSortTree();
    const fileOrder = () =>
      screen
        .queryAllByTestId(/^plans-tab-file-project-/)
        .map((el) => el.getAttribute("data-testid")!.replace("plans-tab-file-project-", ""));

    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    expect(fileOrder()).toEqual(["2026-02-02-new.md", "2026-01-01-old.md"]);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY)!)).toEqual({
        sortKey: "name",
        sortDir: "desc",
      }),
    );

    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(fileOrder()).toEqual(["2026-01-01-old.md", "2026-02-02-new.md"]);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY)!)).toEqual({
        sortKey: "name",
        sortDir: "asc",
      }),
    );
  });
});
