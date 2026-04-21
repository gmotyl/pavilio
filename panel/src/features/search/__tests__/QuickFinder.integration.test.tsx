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
