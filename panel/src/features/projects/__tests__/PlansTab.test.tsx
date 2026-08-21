import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import PlansTab from "../PlansTab";

const TREE = {
  project: "alokai",
  sources: [
    {
      id: "project",
      label: "alokai",
      absoluteRoot: "/p/projects/alokai/plans",
      files: [
        {
          source: "project",
          filename: "2026-01-01-foo.md",
          absolutePath: "/p/projects/alokai/plans/2026-01-01-foo.md",
          modified: 2,
          relativeToProjectsDir: "alokai/plans/2026-01-01-foo.md",
        },
      ],
    },
    {
      id: "workspace",
      label: "workspace (.kilo)",
      absoluteRoot: "/p/.kilo/plans",
      files: [
        {
          source: "workspace",
          filename: "woo.md",
          absolutePath: "/p/.kilo/plans/woo.md",
          modified: 1,
          relativeToProjectsDir: null,
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockFetchResponses({
    "plans-tree": TREE,
    "plans/read": { absolutePath: "/p/.kilo/plans/woo.md", content: "# Hello plan body" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlansTab", () => {
  it("renders a node per source", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    expect(await screen.findByTestId("plans-tab-source-project")).toBeTruthy();
    expect(screen.getByTestId("plans-tab-source-workspace")).toBeTruthy();
    expect(screen.getByText("projects (current)")).toBeTruthy();
  });

  it("collapses a source when its header is clicked", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    const fileBtn = await screen.findByTestId("plans-tab-file-project-2026-01-01-foo.md");
    expect(fileBtn).toBeTruthy();
    fireEvent.click(screen.getByTestId("plans-tab-source-project"));
    expect(screen.queryByTestId("plans-tab-file-project-2026-01-01-foo.md")).toBeNull();
  });

  it("loads and renders a plan when a file is clicked", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    const fileBtn = await screen.findByTestId("plans-tab-file-workspace-woo.md");
    fireEvent.click(fileBtn);
    await waitFor(() => expect(screen.getByText("Hello plan body")).toBeTruthy());
  });

  it("stars a project plan that is in currentPlans", async () => {
    renderWithRouter(
      <PlansTab
        projectName="alokai"
        currentPlans={["alokai/plans/2026-01-01-foo.md"]}
      />,
    );
    expect(await screen.findByTestId("plans-tab-star-2026-01-01-foo.md")).toBeTruthy();
    // workspace (non-project) files are not starrable
    expect(screen.queryByTestId("plans-tab-star-woo.md")).toBeNull();
  });

  it("makes plan file rows draggable", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    const fileBtn = await screen.findByTestId("plans-tab-file-workspace-woo.md");
    expect(fileBtn.getAttribute("draggable")).toBe("true");
  });

  it("restores the open plan from the ?file= URL param", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />, {
      initialEntries: [
        `/?file=${encodeURIComponent("/p/.kilo/plans/woo.md")}`,
      ],
    });
    await waitFor(() => expect(screen.getByText("Hello plan body")).toBeTruthy());
  });

  it("persists the open plan to sessionStorage and shows path actions", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    // The tab auto-opens the newest plan (foo.md) on load. Wait for that to
    // settle before clicking, otherwise the auto-select effect races the click
    // and can clobber the user's choice back to the default.
    await screen.findByTestId("plans-tab-file-workspace-woo.md");
    await waitFor(() =>
      expect(sessionStorage.getItem("panel:lastFile:alokai:plans")).toBe(
        "/p/projects/alokai/plans/2026-01-01-foo.md",
      ),
    );
    fireEvent.click(screen.getByTestId("plans-tab-file-workspace-woo.md"));
    await waitFor(() => expect(screen.getByText("Hello plan body")).toBeTruthy());
    expect(screen.getByTestId("file-viewer-vscode")).toBeTruthy();
    expect(screen.getByTestId("file-viewer-copy-path")).toBeTruthy();
    await waitFor(() =>
      expect(sessionStorage.getItem("panel:lastFile:alokai:plans")).toBe(
        "/p/.kilo/plans/woo.md",
      ),
    );
  });

  it("renders archived plans as a default-collapsed 'Archived' group", async () => {
    const ARCHIVED_FILE = "2025-12-01-old-design.md";
    mockFetchResponses({
      "plans-tree": {
        project: "alokai",
        sources: [
          TREE.sources[0],
          {
            id: "project:archived",
            label: "Archived",
            absoluteRoot: "/p/projects/alokai/plans/archived",
            files: [
              {
                source: "project:archived",
                filename: ARCHIVED_FILE,
                absolutePath: `/p/projects/alokai/plans/archived/${ARCHIVED_FILE}`,
                modified: 1,
                relativeToProjectsDir: `alokai/plans/archived/${ARCHIVED_FILE}`,
              },
            ],
          },
        ],
      },
      "plans/read": { absolutePath: "/p/projects/alokai/plans/2026-01-01-foo.md", content: "# body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    const header = await screen.findByTestId("plans-tab-source-project:archived");
    expect(screen.getByText("Archived")).toBeTruthy();
    // Collapsed by default — the archived file is not rendered until expanded.
    expect(
      screen.queryByTestId(`plans-tab-file-project:archived-${ARCHIVED_FILE}`),
    ).toBeNull();
    fireEvent.click(header);
    expect(
      screen.getByTestId(`plans-tab-file-project:archived-${ARCHIVED_FILE}`),
    ).toBeTruthy();
  });

  it("opens the peek when the open file's name is hovered (collapsed desktop)", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    // A plan auto-selects; collapse the sidebar so a hover-peek is possible.
    const toggle = await screen.findByTestId("file-list-sidebar-toggle");
    fireEvent.click(toggle);
    const name = await screen.findByTestId("file-list-peek-trigger");
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    fireEvent.mouseEnter(name);
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
  });

  it("adds a plan to active via POST when an unstarred project plan's star is clicked", async () => {
    const mockFetch = mockFetchResponses({
      "plans-tree": TREE,
      "plans/current": { ok: true },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    const star = await screen.findByTestId("plans-tab-star-2026-01-01-foo.md");
    fireEvent.click(star);
    await waitFor(() => {
      const posted = mockFetch.mock.calls.find(
        ([url, opts]) =>
          String(url).includes("/plans/current/") && opts?.method === "POST",
      );
      expect(posted).toBeTruthy();
    });
  });
});
