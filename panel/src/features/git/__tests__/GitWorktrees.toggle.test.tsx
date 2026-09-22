import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import GitWorktrees from "../GitWorktrees";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

/**
 * Two properties of the worktree expander that the preferences migration is
 * free to move but not to change.
 *
 * COMPOSITION: two toggles of the SAME worktree in one tick must cancel. The
 * value written has to be derived from the LATEST expanded set, not from the
 * one the render closure captured before either click — otherwise both clicks
 * read the pre-batch set, both compute "open", and the pane ends expanded with
 * `true` written twice.
 *
 * TOLERANCE: `server/lib/discovery.ts` does no runtime validation, and neither
 * does anything between `git worktree list` and this component, so a path can
 * arrive `undefined`. A blank-scope guard spelt `path.trim() !== ""` turns that
 * into a TypeError — the guard becomes the throw it was added to prevent.
 */

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

const BRANCHES = {
  current: "feat",
  branches: ["main", "feat"],
};

function mountFetch(worktrees: unknown[]) {
  return mockFetchResponses({
    "/api/git/worktrees": worktrees,
    "/api/git/branch-diff-files": { files: [], commitsAhead: 0 },
    "/api/git/branches": BRANCHES,
    "/api/git/branch": { branch: "main" },
  });
}

describe("GitWorktrees toggle", () => {
  beforeEach(() => {
    mountFetch([
      { path: "/git/alpha", head: "a", branch: "main" },
      { path: "/git/alpha/wt", head: "b", branch: "feat" },
    ]);
  });

  it("composes two toggles of the same worktree in one tick", async () => {
    renderWithRouter(<GitWorktrees repo="/git/alpha" />);
    const button = await screen.findByTestId(
      "git-worktree-toggle-/git/alpha/wt",
    );

    // One tick, two clicks: React batches both handlers before re-rendering, so
    // the second must see the first's result or the pair does not cancel.
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(button).toHaveAttribute("aria-label", "Expand worktree");
    expect(
      readPreference(preferences.worktreeExpanded, "/git/alpha/wt"),
    ).toBe(false);
  });

  it("tolerates a worktree whose path never arrived", async () => {
    mountFetch([
      { path: "/git/alpha", head: "a", branch: "main" },
      { head: "b", branch: "feat" },
      { path: "/git/alpha/wt", head: "c", branch: "other" },
    ]);
    renderWithRouter(<GitWorktrees repo="/git/alpha" />);

    // The healthy rows still render: a missing path degrades that one row, it
    // does not take the list down.
    await screen.findByTestId("git-worktree-toggle-/git/alpha/wt");
    await waitFor(() => {
      expect(
        screen.getByTestId("git-worktree-toggle-/git/alpha/wt"),
      ).toBeInTheDocument();
    });

    const orphan = screen.getByTestId("git-worktree-toggle-undefined");
    await act(async () => {
      orphan.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // It toggled locally and wrote nothing: there is no scope to write under.
    expect(orphan).toHaveAttribute("aria-label", "Collapse worktree");
  });
});
