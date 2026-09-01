import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import { ActiveFileProvider } from "../../explorer/useActiveFile";

// Mock the socket so a `file-change` frame can be injected on demand (the plans
// tree refreshes on that frame). `lastMessage` is a module-scope let the tests
// flip, then rerender to let the hook's effect re-run.
let lastMessage: { type: string } | null = null;
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage }),
}));

import PlansTab from "../PlansTab";

// Legacy (flat) plan sources — files, not OpenSpec changes.
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

const artifact = (over: Record<string, unknown>) => ({
  kind: "proposal",
  capability: null,
  filename: "proposal.md",
  modified: 5,
  relativeToProjectsDir: null,
  ...over,
});

// Two OpenSpec sources that both carry the SAME change id → one coordinated group.
const OPENSPEC_TREE = {
  project: "alokai",
  sources: [
    TREE.sources[0],
    {
      id: "openspec:project",
      label: "alokai (OpenSpec)",
      kind: "openspec",
      mode: "store",
      openspecDir: "/p/projects/alokai/plans/openspec",
      changes: [
        {
          changeId: "add-fulfillment-api",
          source: "openspec:project",
          status: "active",
          archiveDate: null,
          artifacts: [
            artifact({
              kind: "proposal",
              filename: "proposal.md",
              absolutePath: "/p/openspec/changes/add-fulfillment-api/proposal.md",
            }),
          ],
        },
      ],
    },
    {
      id: "openspec:repo:storefront",
      label: "storefront (OpenSpec)",
      kind: "openspec",
      mode: "native",
      openspecDir: "/r/storefront/openspec",
      changes: [
        {
          changeId: "add-fulfillment-api",
          source: "openspec:repo:storefront",
          status: "active",
          archiveDate: null,
          artifacts: [
            artifact({
              kind: "design",
              filename: "design.md",
              absolutePath: "/r/storefront/openspec/changes/add-fulfillment-api/design.md",
            }),
            artifact({
              kind: "spec",
              capability: "fulfillment",
              filename: "spec.md",
              absolutePath:
                "/r/storefront/openspec/changes/add-fulfillment-api/specs/fulfillment/spec.md",
            }),
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  lastMessage = null;
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

  it("restores the open plan from the ?file= URL param", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />, {
      initialEntries: [`/?file=${encodeURIComponent("/p/.kilo/plans/woo.md")}`],
    });
    await waitFor(() => expect(screen.getByText("Hello plan body")).toBeTruthy());
  });

  it("persists the open plan to sessionStorage and shows path actions", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
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
    const toggle = await screen.findByTestId("file-list-sidebar-toggle");
    fireEvent.click(toggle);
    const name = await screen.findByTestId("file-list-peek-trigger");
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    fireEvent.mouseEnter(name);
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
  });

  it("surfaces a configured OpenSpec source whose directory is missing", async () => {
    mockFetchResponses({
      "plans-tree": {
        project: "alokai",
        sources: [
          TREE.sources[0],
          {
            id: "openspec:repo:storefront",
            label: "storefront (OpenSpec)",
            kind: "openspec",
            mode: "store",
            openspecDir: "/p/projects/alokai/projects/alokai/plans/storefront/openspec",
            changes: [],
            missing: true,
          },
        ],
      },
      "plans/read": { content: "# body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    const header = await screen.findByTestId("plans-tab-source-openspec:repo:storefront");
    expect(header).toBeTruthy();
    // The configured path is on screen so a wrong repos.json root is fixable
    // without reading server logs.
    expect(
      screen.getByText(
        /\/p\/projects\/alokai\/projects\/alokai\/plans\/storefront\/openspec/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/repos\.json/)).toBeTruthy();
  });

  it("groups equal OpenSpec change ids across sources", async () => {
    mockFetchResponses({
      "plans-tree": OPENSPEC_TREE,
      "plans/read": { content: "# artifact body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    // A single coordinated change group carries both sources' artifacts.
    expect(
      await screen.findByTestId("plans-tab-source-change:add-fulfillment-api"),
    ).toBeTruthy();
    // Only ONE group for the shared change id.
    expect(
      screen.getAllByTestId("plans-tab-source-change:add-fulfillment-api"),
    ).toHaveLength(1);
    expect(
      screen.getByTestId(
        "plans-tab-change-src-openspec:project-add-fulfillment-api",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        "plans-tab-change-src-openspec:repo:storefront-add-fulfillment-api",
      ),
    ).toBeTruthy();
  });

  it("keeps source children distinct inside a coordinated change", async () => {
    mockFetchResponses({
      "plans-tree": OPENSPEC_TREE,
      "plans/read": { content: "# artifact body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    // The project store's proposal and the repo's design/spec are separate rows,
    // keyed by their owning source id.
    expect(
      await screen.findByTestId(
        "plans-tab-artifact-openspec:project-add-fulfillment-api-proposal",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        "plans-tab-artifact-openspec:repo:storefront-add-fulfillment-api-design",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        "plans-tab-artifact-openspec:repo:storefront-add-fulfillment-api-spec-fulfillment",
      ),
    ).toBeTruthy();
  });

  it("marks active vs archived changes from directory, not a pointer", async () => {
    mockFetchResponses({
      "plans-tree": {
        project: "alokai",
        sources: [
          {
            id: "openspec:project",
            label: "alokai (OpenSpec)",
            kind: "openspec",
            mode: "store",
            openspecDir: "/p/openspec",
            changes: [
              {
                changeId: "live-change",
                source: "openspec:project",
                status: "active",
                archiveDate: null,
                artifacts: [
                  artifact({
                    kind: "proposal",
                    absolutePath: "/p/openspec/changes/live-change/proposal.md",
                  }),
                ],
              },
              {
                changeId: "done-change",
                source: "openspec:project",
                status: "archived",
                archiveDate: "2026-01-05",
                artifacts: [
                  artifact({
                    kind: "proposal",
                    absolutePath:
                      "/p/openspec/changes/archive/done-change/proposal.md",
                  }),
                ],
              },
            ],
          },
        ],
      },
      "plans/read": { content: "# artifact body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    // Active change: artifact visible immediately (group open).
    expect(
      await screen.findByTestId(
        "plans-tab-artifact-openspec:project-live-change-proposal",
      ),
    ).toBeTruthy();
    // Archived change: group present but collapsed → artifact not rendered yet.
    expect(screen.getByTestId("plans-tab-source-change:done-change")).toBeTruthy();
    expect(
      screen.queryByTestId(
        "plans-tab-artifact-openspec:project-done-change-proposal",
      ),
    ).toBeNull();
  });

  it("collapses archived OpenSpec changes by default", async () => {
    mockFetchResponses({
      "plans-tree": {
        project: "alokai",
        sources: [
          // The "project" legacy node is always present (server always emits it),
          // so the sidebar renders per-source group headers.
          TREE.sources[0],
          {
            id: "openspec:project",
            label: "alokai (OpenSpec)",
            kind: "openspec",
            mode: "store",
            openspecDir: "/p/openspec",
            changes: [
              {
                changeId: "done-change",
                source: "openspec:project",
                status: "archived",
                archiveDate: "2026-01-05",
                artifacts: [
                  artifact({
                    kind: "proposal",
                    absolutePath:
                      "/p/openspec/changes/archive/done-change/proposal.md",
                  }),
                ],
              },
            ],
          },
        ],
      },
      "plans/read": { content: "# artifact body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    const header = await screen.findByTestId(
      "plans-tab-source-change:done-change",
    );
    expect(
      screen.queryByTestId(
        "plans-tab-artifact-openspec:project-done-change-proposal",
      ),
    ).toBeNull();
    fireEvent.click(header);
    expect(
      screen.getByTestId(
        "plans-tab-artifact-openspec:project-done-change-proposal",
      ),
    ).toBeTruthy();
  });

  it("retains legacy plan sources beside OpenSpec sources", async () => {
    mockFetchResponses({
      "plans-tree": OPENSPEC_TREE,
      "plans/read": { content: "# body" },
    });
    renderWithRouter(<PlansTab projectName="alokai" />);
    // Legacy flat source and the OpenSpec coordinated change both render.
    expect(await screen.findByTestId("plans-tab-source-project")).toBeTruthy();
    expect(
      screen.getByTestId("plans-tab-file-project-2026-01-01-foo.md"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("plans-tab-source-change:add-fulfillment-api"),
    ).toBeTruthy();
  });

  it("refreshes grouped artifacts after a file-change event", async () => {
    mockFetchResponses({
      "plans-tree": OPENSPEC_TREE,
      "plans/read": { content: "# body" },
    });
    const { rerender } = renderWithRouter(<PlansTab projectName="alokai" />);
    await screen.findByTestId(
      "plans-tab-artifact-openspec:project-add-fulfillment-api-proposal",
    );
    // A teammate adds a change while the tab is open → server now returns it.
    const withNewChange = {
      project: "alokai",
      sources: [
        TREE.sources[0],
        {
          id: "openspec:project",
          label: "alokai (OpenSpec)",
          kind: "openspec",
          mode: "store",
          openspecDir: "/p/projects/alokai/plans/openspec",
          changes: [
            {
              changeId: "add-fulfillment-api",
              source: "openspec:project",
              status: "active",
              archiveDate: null,
              artifacts: [
                artifact({
                  kind: "proposal",
                  absolutePath:
                    "/p/openspec/changes/add-fulfillment-api/proposal.md",
                }),
              ],
            },
            {
              changeId: "add-tax-engine",
              source: "openspec:project",
              status: "active",
              archiveDate: null,
              artifacts: [
                artifact({
                  kind: "proposal",
                  absolutePath: "/p/openspec/changes/add-tax-engine/proposal.md",
                }),
              ],
            },
          ],
        },
      ],
    };
    mockFetchResponses({
      "plans-tree": withNewChange,
      "plans/read": { content: "# body" },
    });
    lastMessage = { type: "file-change" };
    // rerender with the full wrapper so the Router context is preserved and the
    // hook's file-change effect re-runs against the new server response.
    rerender(
      <MemoryRouter>
        <ActiveFileProvider>
          <PlansTab projectName="alokai" />
        </ActiveFileProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByTestId("plans-tab-source-change:add-tax-engine"),
    ).toBeTruthy();
  });

  it("removes the star control and CURRENT.md-based active plans", async () => {
    renderWithRouter(<PlansTab projectName="alokai" />);
    await screen.findByTestId("plans-tab-file-project-2026-01-01-foo.md");
    // No star toggle exists anymore on any plan row.
    expect(screen.queryByTestId("plans-tab-star-2026-01-01-foo.md")).toBeNull();
    expect(screen.queryByTestId("plans-tab-star-woo.md")).toBeNull();
  });
});
