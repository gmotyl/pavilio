import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickFinder from "../QuickFinder";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";

const mockFiles = [
  {
    relativePath: "my-work/notes/daily.md",
    project: "my-work",
    modified: 1700000000000,
  },
  {
    relativePath: "my-pet-project/PROJECT.md",
    project: "my-pet-project",
    modified: 1700000001000,
  },
  {
    relativePath: "my-blog/plans/migration.md",
    project: "my-blog",
    modified: 1700000002000,
  },
];

// Stub WebSocket since useFileIndex depends on useWebSocket
class MockWebSocket {
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  close() {}
}

describe("QuickFinder integration", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetchResponses({
      "/api/files/index": mockFiles,
    });
  });

  it("opens on Cmd+P and shows files", async () => {
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    // Trigger Cmd+P
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search files/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("my-work/notes/daily.md")).toBeInTheDocument();
    });
  });

  it("filters files by typing", async () => {
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search files/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("my-work/notes/daily.md")).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText(/Search files/), "PROJECT");
    await waitFor(() => {
      expect(screen.getByText("my-pet-project/PROJECT.md")).toBeInTheDocument();
    });
    expect(screen.queryByText("my-work/notes/daily.md")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search files/)).toBeInTheDocument();
    });
    // Press Escape on the input directly — Escape is handled by input's onKeyDown
    await user.type(screen.getByPlaceholderText(/Search files/), "{Escape}");
    expect(
      screen.queryByPlaceholderText(/Search files/),
    ).not.toBeInTheDocument();
  });
});

describe("QuickFinder archived toggle", () => {
  const archiveFiles = [
    {
      relativePath: "alpha/notes/a.md",
      project: "alpha",
      modified: 1,
      archived: false,
    },
    {
      relativePath: "archived/beta/notes/b.md",
      project: "beta",
      modified: 1,
      archived: true,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    localStorage.clear();
  });

  it("hides archived files when the archived toggle is off", async () => {
    mockFetchResponses({
      "/api/files/index": archiveFiles,
    });
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByText("alpha/notes/a.md")).toBeInTheDocument();
    });
    expect(
      screen.getByText("archived/beta/notes/b.md"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("quick-finder-toggle-archived"));

    await waitFor(() => {
      expect(
        screen.queryByText("archived/beta/notes/b.md"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("alpha/notes/a.md")).toBeInTheDocument();
    expect(localStorage.getItem("panel-search-include-archived")).toBe(
      "false",
    );
  });

  it("defaults to including archived files", async () => {
    mockFetchResponses({
      "/api/files/index": archiveFiles,
    });
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByText("alpha/notes/a.md")).toBeInTheDocument();
    });
    expect(
      screen.getByText("archived/beta/notes/b.md"),
    ).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
  });

  it("passes includeArchived to grep fetch", async () => {
    localStorage.setItem("panel-search-include-archived", "false");
    const mockFetch = mockFetchResponses({
      "/api/files/index": archiveFiles,
      "/api/search/grep": [],
    });
    const user = userEvent.setup();
    renderWithRouter(<QuickFinder />);
    await user.keyboard("{Meta>}p{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search files/)).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText(/Search files/), "?needle");

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some((call) =>
          String(call[0]).includes(
            "/api/search/grep?q=needle&includeArchived=false",
          ),
        ),
      ).toBe(true);
    });
  });
});
