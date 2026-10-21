import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GitBranchDiff from "../GitBranchDiff";
import GitChanges from "../GitChanges";
import GitHistory from "../GitHistory";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { TREE_BOUNDS } from "../repoTree";
import { dragBy, installMatchMedia, stubFetch } from "../../../test-utils";

const FILES = [
  { status: "M", path: "src/a.ts" },
  { status: "??", path: "src/b.ts" },
];

const COMMITS = [
  {
    sha: "abc1234def5678",
    shortSha: "abc1234",
    message: "a commit worth reading",
    author: "seed",
    date: "2026-09-21T09:00:00.000Z",
  },
];

const BRANCHES = { current: "feature/search", branches: ["main", "develop"] };

/**
 * One stub for all three views: the cross-scope test renders them side by
 * side, and a per-view stub would have to be merged there anyway.
 *
 * The order of the keys below is load-bearing — `/api/git/branch-diff-files`
 * is a prefix-mate of `/api/git/branch-diff`, and `/api/git/branches` of
 * `/api/git/branch?`.
 */
const GIT_ROUTES = {
  "/api/git/branch-diff-files": { files: FILES, commitsAhead: 1 },
  "/api/git/branch-diff": { diff: "" },
  "/api/git/branches": BRANCHES,
  "/api/git/branch?": { branch: "main" },
  "/api/git/status": FILES,
  "/api/git/log": COMMITS,
  "/api/git/commit-files": FILES,
  "/api/git/suggest-message": { suggestion: "" },
  "/api/git/diff": { diff: "" },
};

const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
    .__PAVILIO_PREFS__!;

/**
 * The tree only exists beside an open diff, so the file is supplied through
 * `openFile` — the same way the router drives this component from `?file=` —
 * rather than clicked to first. The base branch is the auto-selected `main`,
 * because nothing is stored for this repo.
 */
async function renderTree() {
  const view = render(
    <GitBranchDiff showListSidebar repo="/repo" openFile="src/a.ts" />,
  );
  await screen.findByTestId("git-branch-diff-tree");
  return view;
}

const tree = () => screen.getByTestId("git-branch-diff-tree");
const rail = () => screen.getByTestId("pane-resize-git-branch-diff");

/**
 * The one box in the tree that scrolls — found by its `overflow-y-auto`
 * wherever it currently sits, deliberately NOT by a test id. A test id would
 * have to be attached to whichever element the implementation chose, and the
 * thing worth pinning is exactly that choice.
 */
function scroller(box: HTMLElement): HTMLElement {
  const found = [box, ...box.querySelectorAll<HTMLElement>("*")].filter((el) =>
    el.classList.contains("overflow-y-auto"),
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe("resizing the git-branch-diff tree", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    installMatchMedia();
    stubFetch(GIT_ROUTES);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a resize rail on the Branch Diff tree's inner edge", async () => {
    await renderTree();
    const handle = rail();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    // The inner edge — the seam with the diff, not the window edge.
    expect(handle).toHaveAttribute("data-edge", "right");
    // The rail lives inside the sticky box, so it travels with it.
    expect(tree().contains(handle)).toBe(true);
  });

  it("widens the Branch Diff tree when the rail is dragged", async () => {
    await renderTree();
    dragBy(rail(), 60);

    expect(tree()).toHaveStyle({ width: "340px" });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(340);

    // And the drag stops where the shared bounds say it does — the same
    // object the other two trees are given, so a bound that drifted here
    // would be a difference only a drag to each stop could find.
    dragBy(rail(), 600);
    expect(tree()).toHaveStyle({ width: `${TREE_BOUNDS.max}px` });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.max);

    dragBy(rail(), -600);
    expect(tree()).toHaveStyle({ width: `${TREE_BOUNDS.min}px` });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.min);
  });

  it("leaves the Branch Diff tree's width unapplied on a narrow viewport", async () => {
    installMatchMedia({ mobile: true });
    await renderTree();

    expect(screen.queryByTestId("pane-resize-git-branch-diff")).toBeNull();
    // And no width either. The tree is `hidden md:block`, so a px width here
    // would be a desktop habit written onto a box the phone never shows — and
    // with no rail there is nothing to undo it with.
    expect(tree().style.width).toBe("");
  });

  it("scrolls the inner container, not the aside", async () => {
    await renderTree();
    const box = scroller(tree());

    // An absolute child of a SCROLL container scrolls away with the content, so
    // leaving the `overflow-y-auto` on the aside — the tidy-looking option —
    // makes the rail vanish the moment you scroll the tree.
    expect(box).not.toBe(tree());
    expect(tree().contains(box)).toBe(true);
    expect(tree().className).not.toMatch(/overflow/);
  });

  it("renders all three scopes at a width stored by any one of them", async () => {
    // One stored value, written before anything mounts — whichever tree the
    // user happened to drag last is the one that wrote it.
    doc()[preferences.repoTreePaneWidth.key] = 360;

    render(
      <>
        <GitHistory
          showListSidebar
          repo="/repo"
          activeSha={COMMITS[0].sha}
          activeFile="src/a.ts"
        />
        <GitChanges showListSidebar repo="/repo" openFile="src/a.ts" />
        <GitBranchDiff showListSidebar repo="/repo" openFile="src/a.ts" />
      </>,
    );

    const trees = [
      await screen.findByTestId("git-history-tree"),
      await screen.findByTestId("git-changes-tree"),
      await screen.findByTestId("git-branch-diff-tree"),
    ];

    // The point of the whole change: three views of the same repo tree, one
    // width. A per-view declaration would leave two of these at 280.
    for (const box of trees) {
      expect(box).toHaveStyle({ width: "360px" });
      expect(box.className).not.toMatch(/\bw-\[\d+px\]/);
      // And the same structure under each: the scroller is the inner div, so
      // the rail stays put in all three.
      expect(scroller(box)).not.toBe(box);
    }

    // A drag on one of them moves the shared value, so the other two follow on
    // the next render — same key, same store, one subscription each.
    fireEvent.pointerDown(rail(), { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(rail(), { pointerId: 1, clientX: 640 });
    fireEvent.pointerUp(rail(), { pointerId: 1, clientX: 640 });

    for (const testId of [
      "git-history-tree",
      "git-changes-tree",
      "git-branch-diff-tree",
    ]) {
      expect(screen.getByTestId(testId)).toHaveStyle({ width: "400px" });
    }
  });
});
