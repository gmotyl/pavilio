import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import GitChanges from "../GitChanges";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";

// Stateful stub of the realtime channel so tests can push messages.
const ws = vi.hoisted(() => ({ setLast: (_m: unknown) => {} }));
vi.mock("../../realtime/useWebSocket", () => {
  const React = require("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState(null);
      React.useEffect(() => {
        ws.setLast = setLastMessage;
      }, []);
      return { lastMessage };
    },
  };
});

/**
 * Regression: auto-sync commits and pushes the data paths, but only broadcast
 * `sync-status`. GitChanges subscribed to nothing, so the file list stayed frozen at
 * page-load state — files already committed kept showing, which reads as "sync did
 * nothing". See the 2026-07-29 report: "I clicked the sync button and they are still there."
 */
describe("GitChanges refreshes on git-change", () => {
  beforeEach(() => {
    mockFetchResponses({
      "/api/git/status": [{ status: "M", path: "projects/p/note.md" }],
      "/api/git/branch": { branch: "main" },
      "/api/git/suggest-message": { suggestion: "update(p): " },
      "/api/git/branches": { current: "main", branches: ["main"] },
      "/api/git/worktrees": [],
    });
  });

  it("refetches the file list when the server broadcasts git-change", async () => {
    renderWithRouter(<GitChanges showCommit />);
    await waitFor(() =>
      expect(screen.getByText("projects/p/note.md")).toBeInTheDocument(),
    );

    // Sync committed the file: the next status call returns an empty tree.
    mockFetchResponses({
      "/api/git/status": [],
      "/api/git/branch": { branch: "main" },
      "/api/git/suggest-message": { suggestion: "update(p): " },
      "/api/git/branches": { current: "main", branches: ["main"] },
      "/api/git/worktrees": [],
    });

    act(() => ws.setLast({ type: "git-change" }));

    await waitFor(() =>
      expect(screen.queryByText("projects/p/note.md")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("ignores unrelated realtime messages", async () => {
    renderWithRouter(<GitChanges showCommit />);
    await waitFor(() =>
      expect(screen.getByText("projects/p/note.md")).toBeInTheDocument(),
    );

    mockFetchResponses({
      "/api/git/status": [],
      "/api/git/branch": { branch: "main" },
      "/api/git/suggest-message": { suggestion: "update(p): " },
      "/api/git/branches": { current: "main", branches: ["main"] },
      "/api/git/worktrees": [],
    });

    act(() => ws.setLast({ type: "sync-status", state: "synced" }));

    // sync-status must not trigger a refetch on its own — the list is unchanged.
    expect(screen.getByText("projects/p/note.md")).toBeInTheDocument();
  });
});
