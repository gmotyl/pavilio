import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitBranchDiff from "../GitBranchDiff";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

/**
 * Two panes, one preference.
 *
 * `RepoBlock` renders a `GitBranchDiff` for the repo path `repos.json` ships —
 * tilde-spelled — and `GitWorktrees`, below it, renders another for the main
 * worktree's absolute path that `git worktree list` prints. Unifying the two
 * spellings onto one repo scope means those two panes now address ONE stored
 * value. Local state seeded once by `readPreference` does not: closing the
 * outer pane leaves the nested one rendering open, and the nested pane's next
 * click re-asserts `false` from its stale state instead of inverting it. The
 * user has to click twice and the two panes disagree until a remount.
 *
 * That is same-tab incoherence the two separate keys never had, so it is a new
 * bug rather than preserved behavior — the panes have to share the value, not
 * only the key.
 */

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

const BRANCHES = {
  current: "feature/search",
  branches: ["main", "feature/search", "develop"],
};

const OUTER = "outer-pane";
const NESTED = "nested-pane";

const pane = (id: string) => within(screen.getByTestId(id));
const isOpen = (id: string) =>
  pane(id).queryByTestId("git-branch-diff-base-toggle") !== null;

describe("branch-diff panes that share one repo scope", () => {
  beforeEach(() => {
    mockFetchResponses({
      "/api/git/branch-diff-files": { files: [], commitsAhead: 0 },
      "/api/git/branches": BRANCHES,
    });
  });

  it("agree on one click, in both directions", async () => {
    const globals = globalThis as { __PAVILIO_HOME__?: string };
    globals.__PAVILIO_HOME__ = "/home/greg";
    try {
      const user = userEvent.setup();
      renderWithRouter(
        <>
          <div data-testid={OUTER}>
            {/* The spelling `repos.json` ships, straight through discovery. */}
            <GitBranchDiff repo="~/git/prv/pavilio" />
          </div>
          <div data-testid={NESTED}>
            {/* The spelling `git worktree list` prints. */}
            <GitBranchDiff repo="/home/greg/git/prv/pavilio" />
          </div>
        </>,
      );

      // Both start open: `git.branchDiff.open` defaults to true.
      await waitFor(() => expect(isOpen(OUTER)).toBe(true));
      expect(isOpen(NESTED)).toBe(true);

      // ONE click on the outer pane closes BOTH.
      await user.click(pane(OUTER).getByTestId("git-branch-diff-toggle"));
      await waitFor(() => expect(isOpen(OUTER)).toBe(false));
      expect(isOpen(NESTED)).toBe(false);
      expect(
        readPreference(preferences.branchDiffOpen, "/home/greg/git/prv/pavilio"),
      ).toBe(false);

      // And ONE click on the nested pane reopens both — it inverts the shared
      // value rather than re-asserting a stale local one.
      await user.click(pane(NESTED).getByTestId("git-branch-diff-toggle"));
      await waitFor(() => expect(isOpen(NESTED)).toBe(true));
      expect(isOpen(OUTER)).toBe(true);
      expect(
        readPreference(preferences.branchDiffOpen, "/home/greg/git/prv/pavilio"),
      ).toBe(true);
    } finally {
      delete globals.__PAVILIO_HOME__;
    }
  });

  it("shares the base branch too", async () => {
    const globals = globalThis as { __PAVILIO_HOME__?: string };
    globals.__PAVILIO_HOME__ = "/home/greg";
    try {
      const user = userEvent.setup();
      renderWithRouter(
        <>
          <div data-testid={OUTER}>
            <GitBranchDiff repo="~/git/prv/pavilio" />
          </div>
          <div data-testid={NESTED}>
            <GitBranchDiff repo="/home/greg/git/prv/pavilio" />
          </div>
        </>,
      );

      await user.click(
        await pane(OUTER).findByTestId("git-branch-diff-base-toggle"),
      );
      await user.click(
        await pane(OUTER).findByTestId("git-branch-diff-base-option-develop"),
      );

      await waitFor(() => {
        expect(
          pane(NESTED).getByTestId("git-branch-diff-base-toggle"),
        ).toHaveTextContent("develop");
      });
    } finally {
      delete globals.__PAVILIO_HOME__;
    }
  });

  it("renders when the repo path never arrived", async () => {
    // `server/lib/discovery.ts` validates nothing, so a `repos.json` entry with
    // no `path` reaches this component as `undefined`. A blank-scope guard
    // spelt `repo.trim() === ""` throws DURING RENDER and takes the whole
    // RepoBlock subtree with it.
    renderWithRouter(
      <GitBranchDiff repo={undefined as unknown as string} />,
    );

    await screen.findByTestId("git-branch-diff-toggle");
    expect(screen.getByText("Branch Diff")).toBeInTheDocument();
  });
});
