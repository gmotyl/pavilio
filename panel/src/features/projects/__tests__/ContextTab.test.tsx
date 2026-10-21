import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import ContextTab from "../ContextTab";

// Mirrors ContextResponse from useProjectContext.ts
const CONTEXT = {
  project: "alokai",
  sources: [
    { id: "project", label: "alokai", absoluteRoot: "/p/projects/alokai" },
    { id: "repo", label: "storefront", absoluteRoot: "/r/storefront" },
  ],
  openspecSpecs: [],
  contexts: [
    {
      source: "project",
      filename: "CONTEXT.md",
      absolutePath: "/p/projects/alokai/CONTEXT.md",
      modified: 2,
      relativeToProjectsDir: "alokai/CONTEXT.md",
    },
    {
      source: "repo",
      filename: "CONTEXT.md",
      absolutePath: "/r/storefront/CONTEXT.md",
      modified: 1,
      relativeToProjectsDir: null,
    },
  ],
  adrs: [
    {
      source: "project",
      filename: "0001-use-pnpm.md",
      absolutePath: "/p/projects/alokai/docs/adr/0001-use-pnpm.md",
      modified: 3,
      adrNumber: 1,
      slug: "use-pnpm",
      relativeToProjectsDir: "alokai/docs/adr/0001-use-pnpm.md",
    },
  ],
  specs: [
    {
      source: "project",
      filename: "checkout-tax.md",
      absolutePath: "/p/projects/alokai/specs/checkout-tax.md",
      modified: 4,
      relativeToProjectsDir: "alokai/specs/checkout-tax.md",
    },
  ],
};

beforeEach(() => {
  mockFetchResponses({
    "context/read": { content: "# Hello context body" },
    "/context": CONTEXT,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContextTab", () => {
  it("selects and renders the file named in ?file=", async () => {
    renderWithRouter(<ContextTab projectName="alokai" />, {
      initialEntries: [
        `/?file=${encodeURIComponent("/p/projects/alokai/CONTEXT.md")}`,
      ],
    });
    expect(
      await screen.findByTestId("context-tab-file-project-CONTEXT.md"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("Hello context body")).toBeTruthy(),
    );
  });

  it("renders a source group per context source", async () => {
    renderWithRouter(<ContextTab projectName="alokai" />);
    expect(await screen.findByTestId("context-tab-source-project")).toBeTruthy();
    expect(screen.getByTestId("context-tab-source-repo")).toBeTruthy();
    expect(screen.getByTestId("context-tab-refresh")).toBeTruthy();
  });

  it("keeps the adr row testids and loads an adr on click", async () => {
    renderWithRouter(<ContextTab projectName="alokai" />);
    const adr = await screen.findByTestId(
      "context-tab-adr-project-0001-use-pnpm.md",
    );
    fireEvent.click(adr);
    await waitFor(() =>
      expect(screen.getByText("Hello context body")).toBeTruthy(),
    );
  });

  it("renders spec rows under a Specs header and loads one on click", async () => {
    renderWithRouter(<ContextTab projectName="alokai" />);
    const spec = await screen.findByTestId(
      "context-tab-spec-project-checkout-tax.md",
    );
    expect(screen.getByText("Specs")).toBeTruthy();
    fireEvent.click(spec);
    await waitFor(() =>
      expect(screen.getByText("Hello context body")).toBeTruthy(),
    );
  });

  it("tolerates a context response without a specs field", async () => {
    const { specs: _omitted, openspecSpecs: _o2, ...legacy } = CONTEXT;
    mockFetchResponses({
      "context/read": { content: "# Hello context body" },
      "/context": legacy,
    });
    renderWithRouter(<ContextTab projectName="alokai" />);
    expect(await screen.findByTestId("context-tab-source-project")).toBeTruthy();
    expect(screen.queryByText("Specs")).toBeNull();
  });

  it("groups nested living specs by repository and capability", async () => {
    const withOpenSpec = {
      ...CONTEXT,
      sources: [
        ...CONTEXT.sources,
        {
          id: "openspec:repo:storefront",
          label: "storefront (OpenSpec)",
          absoluteRoot: "/r/storefront/openspec",
        },
      ],
      openspecSpecs: [
        {
          source: "openspec:repo:storefront",
          capability: "fulfillment",
          filename: "spec.md",
          absolutePath: "/r/storefront/openspec/specs/fulfillment/spec.md",
          modified: 9,
          relativeToProjectsDir: null,
        },
        {
          source: "openspec:repo:storefront",
          capability: "checkout",
          filename: "spec.md",
          absolutePath: "/r/storefront/openspec/specs/checkout/spec.md",
          modified: 8,
          relativeToProjectsDir: null,
        },
      ],
    };
    mockFetchResponses({
      "context/read": { content: "# Hello context body" },
      "/context": withOpenSpec,
    });
    renderWithRouter(<ContextTab projectName="alokai" />);
    // The OpenSpec repo becomes its own source group…
    expect(
      await screen.findByTestId("context-tab-source-openspec:repo:storefront"),
    ).toBeTruthy();
    // …and each capability's living spec renders under it, keyed by capability.
    expect(
      screen.getByTestId(
        "context-tab-openspec-openspec:repo:storefront-fulfillment",
      ),
    ).toBeTruthy();
    const checkout = screen.getByTestId(
      "context-tab-openspec-openspec:repo:storefront-checkout",
    );
    expect(checkout).toBeTruthy();
    fireEvent.click(checkout);
    await waitFor(() =>
      expect(screen.getByText("Hello context body")).toBeTruthy(),
    );
  });
});
