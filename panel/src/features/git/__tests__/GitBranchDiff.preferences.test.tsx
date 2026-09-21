import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitBranchDiff from "../GitBranchDiff";
import GitWorktrees from "../GitWorktrees";
import { useGitViewMode } from "../useGitViewMode";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  readPreference,
} from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

/**
 * The git surface's per-repository settings after the preferences migration.
 *
 * Two things the raw keys got wrong have to be pinned here. A key built by
 * string concatenation — `panel-branch-diff-open-${repo}` — makes the repo
 * PATH part of the key text, so the same repository addressed two ways is two
 * keys: the storage dump found `panel-branch-diff-open-~/git/prv/pavilio` and
 * `panel-branch-diff-open-/root/git/prv/pavilio` holding OPPOSITE values. Both
 * spellings are live — `server/lib/discovery.ts` ships repo paths raw from
 * `repos.json`, where they are tilde-spelled, while `GitWorktrees` renders the
 * absolute paths `git worktree list` prints. A repo-scoped declaration passes
 * the path as the SCOPE ARGUMENT, which `normalizeRepoScope` unifies — but
 * only if the path is never embedded in the key itself.
 *
 * And a migration must not turn a page load into a burst of PATCHes, so the
 * cold render is asserted to write nothing at all.
 */

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

/**
 * The cold-render assertion has to be STRUCTURAL, not a fetch count. The store
 * skips a write whose stored value already matches, so a mount-write of the
 * declared default reaches no PATCH and leaves no document key — it stays
 * invisible until the day the stored value differs from the default, and then
 * shows up as a choice silently reverting on load. Spying on `writePreference`
 * itself is the only way to see the call the store swallowed.
 */
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    writePreference: (...args: Parameters<typeof actual.writePreference>) => {
      writeSpy(...args);
      return actual.writePreference(...args);
    },
  };
});

const BRANCHES = {
  current: "feature/search",
  branches: ["main", "feature/search", "develop"],
};

function doc(): Record<string, unknown> {
  return (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
    .__PAVILIO_PREFS__!;
}

async function pickBase(
  user: ReturnType<typeof userEvent.setup>,
  branch: string,
) {
  await user.click(await screen.findByTestId("git-branch-diff-base-toggle"));
  await user.click(
    await screen.findByTestId(`git-branch-diff-base-option-${branch}`),
  );
}

describe("git branch-diff preferences", () => {
  beforeEach(() => {
    writeSpy.mockClear();
    mockFetchResponses({ "/api/git/branches": BRANCHES });
  });

  it("per-repo branch-diff selections do not bleed between repositories", async () => {
    const user = userEvent.setup();
    const alpha = renderWithRouter(<GitBranchDiff repo="/git/alpha" />);
    await pickBase(user, "develop");

    expect(readPreference(preferences.branchDiffBase, "/git/alpha")).toBe(
      "develop",
    );
    // Nothing was written for a repository the user never touched.
    expect(readPreference(preferences.branchDiffBase, "/git/beta")).toBe("");

    alpha.unmount();
    renderWithRouter(<GitBranchDiff repo="/git/beta" />);
    // Beta falls back to the auto-selected default, not alpha's choice.
    await waitFor(() => {
      expect(
        screen.getByTestId("git-branch-diff-base-toggle"),
      ).toHaveTextContent("main");
    });
  });

  it("a repo addressed by tilde and by absolute path shares one branch-diff preference", async () => {
    const globals = globalThis as { __PAVILIO_HOME__?: string };
    globals.__PAVILIO_HOME__ = "/home/greg";
    try {
      const user = userEvent.setup();
      // The spelling `repos.json` ships, straight through discovery.
      const tilde = renderWithRouter(
        <GitBranchDiff repo="~/git/prv/pavilio" />,
      );
      await pickBase(user, "develop");
      await user.click(screen.getByTestId("git-branch-diff-toggle"));

      // One key per setting, not two — and it is the normalized, absolute one.
      expect(
        Object.keys(doc())
          .filter((key) => key.startsWith("git.branchDiff."))
          .sort(),
      ).toEqual([
        storageKey(preferences.branchDiffBase, "/home/greg/git/prv/pavilio"),
        storageKey(preferences.branchDiffOpen, "/home/greg/git/prv/pavilio"),
      ]);
      expect(
        readPreference(
          preferences.branchDiffOpen,
          "/home/greg/git/prv/pavilio",
        ),
      ).toBe(false);
      // Positive control for the two cold-render tests below: the spy really is
      // the `writePreference` these components reach, so "never called" there
      // means no write was attempted rather than no spy being wired.
      expect(writeSpy).toHaveBeenCalled();

      tilde.unmount();
      // The spelling `git worktree list` prints, as GitWorktrees passes it on.
      renderWithRouter(<GitBranchDiff repo="/home/greg/git/prv/pavilio" />);
      // Closed, because the tilde-spelled render closed it: the base picker
      // only renders inside an open section.
      await screen.findByTestId("git-branch-diff-toggle");
      expect(
        screen.queryByTestId("git-branch-diff-base-toggle"),
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId("git-branch-diff-toggle"));
      await waitFor(() => {
        expect(
          screen.getByTestId("git-branch-diff-base-toggle"),
        ).toHaveTextContent("develop");
      });
    } finally {
      delete globals.__PAVILIO_HOME__;
    }
  });

  it("normalizes a worktree's expanded flag the same way", async () => {
    const globals = globalThis as { __PAVILIO_HOME__?: string };
    globals.__PAVILIO_HOME__ = "/home/greg";
    try {
      mockFetchResponses({
        "/api/git/worktrees": [
          { path: "/home/greg/git/prv/pavilio", head: "a", branch: "main" },
          {
            path: "/home/greg/git/prv/pavilio-prefs",
            head: "b",
            branch: "feat",
          },
        ],
        // Before "/api/git/branch": the mock matches on `includes`, and an
        // expanded worktree renders a GitBranchDiff of its own.
        "/api/git/branch-diff-files": { files: [], commitsAhead: 0 },
        "/api/git/branches": BRANCHES,
        "/api/git/branch": { branch: "main" },
      });
      const user = userEvent.setup();
      renderWithRouter(<GitWorktrees repo="~/git/prv/pavilio" />);

      await user.click(
        await screen.findByTestId(
          "git-worktree-toggle-/home/greg/git/prv/pavilio-prefs",
        ),
      );

      expect(
        readPreference(preferences.worktreeExpanded, "~/git/prv/pavilio-prefs"),
      ).toBe(true);
      expect(
        readPreference(preferences.worktreeExpanded, "~/git/prv/pavilio"),
      ).toBe(false);
    } finally {
      delete globals.__PAVILIO_HOME__;
    }
  });

  it("writes nothing on a cold render of the git surface", async () => {
    const mockFetch = mockFetchResponses({
      "/api/git/branch-diff-files": { files: [], commitsAhead: 0 },
      "/api/git/branches": BRANCHES,
      "/api/git/worktrees": [
        { path: "/git/alpha", head: "a", branch: "main" },
        { path: "/git/alpha/wt", head: "b", branch: "feat" },
      ],
      "/api/git/branch": { branch: "main" },
    });
    renderWithRouter(
      <>
        <GitBranchDiff repo="/git/alpha" />
        <GitWorktrees repo="/git/alpha" />
      </>,
    );
    await screen.findByTestId("git-branch-diff-base-toggle");
    await new Promise((resolve) =>
      setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS * 2),
    );

    // The document is untouched: a mount that only READS leaves it as booted.
    expect(Object.keys(doc())).toEqual(["version"]);
    // Structurally, not by its effect: no write was even attempted.
    expect(writeSpy).not.toHaveBeenCalled();
    // And the store never reached the preferences route at all — the flush
    // window has passed, so a queued PATCH would have left by now.
    expect(
      mockFetch.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.startsWith("/api/preferences")),
    ).toEqual([]);
  });

  it("writes nothing on a cold render over a document that already holds values", async () => {
    // The seeded values DIFFER from the declared defaults, so a mount-write
    // would be a real change the store could not swallow — and would revert the
    // user's choices on every page load.
    doc()[storageKey(preferences.branchDiffOpen, "/git/alpha")] = false;
    doc()[storageKey(preferences.branchDiffBase, "/git/alpha")] = "develop";
    doc()[storageKey(preferences.worktreeExpanded, "/git/alpha/wt")] = true;
    const before = { ...doc() };

    const mockFetch = mockFetchResponses({
      "/api/git/branch-diff-files": { files: [], commitsAhead: 0 },
      "/api/git/branches": BRANCHES,
      "/api/git/worktrees": [
        { path: "/git/alpha", head: "a", branch: "main" },
        { path: "/git/alpha/wt", head: "b", branch: "feat" },
      ],
      "/api/git/branch": { branch: "main" },
    });
    renderWithRouter(
      <>
        <GitBranchDiff repo="/git/alpha" />
        <GitWorktrees repo="/git/alpha" />
      </>,
    );
    // The stored worktree flag was honored, so the render really did read.
    await screen.findByTestId("git-worktree-toggle-/git/alpha/wt");
    await waitFor(() => {
      expect(
        screen.getByTestId("git-worktree-toggle-/git/alpha/wt"),
      ).toHaveAttribute("aria-label", "Collapse worktree");
    });
    // Inside `act`: the expanded worktree's nested GitBranchDiff is still
    // settling its own fetches while the debounce window passes.
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS * 2),
      );
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(doc()).toEqual(before);
    expect(
      mockFetch.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.startsWith("/api/preferences")),
    ).toEqual([]);
  });
});

describe("git view mode", () => {
  it("stays flat with nothing stored and with a malformed stored value", () => {
    expect(renderHook(() => useGitViewMode()).result.current[0]).toBe("flat");

    doc()[storageKey(preferences.gitViewMode)] = "garbage";
    expect(renderHook(() => useGitViewMode()).result.current[0]).toBe("flat");
  });
});
