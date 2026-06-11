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
});
