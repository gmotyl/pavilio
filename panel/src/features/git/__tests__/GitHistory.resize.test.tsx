import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GitHistory from "../GitHistory";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { TREE_BOUNDS } from "../repoTree";
import { dragBy, installMatchMedia, stubFetch } from "../../../test-utils";

const COMMITS = [
  {
    sha: "abc1234def5678",
    shortSha: "abc1234",
    message: "a commit worth reading",
    author: "seed",
    date: "2026-09-21T09:00:00.000Z",
  },
];

const FILES = [{ status: "M", path: "src/a.ts" }];

const GIT_ROUTES = {
  "/api/git/log": COMMITS,
  "/api/git/commit-files": FILES,
  "/api/git/diff": { diff: "" },
};

const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;

/**
 * The tree only exists inside the diff view, so the commit and the file are
 * supplied as controlled props — the same way the router drives this component
 * from `?sha=&file=` — rather than clicked to in three steps.
 */
async function renderTree() {
  const view = render(
    <GitHistory
      showListSidebar
      repo="/repo"
      activeSha={COMMITS[0].sha}
      activeFile="src/a.ts"
    />,
  );
  await screen.findByTestId("git-history-tree");
  return view;
}

const tree = () => screen.getByTestId("git-history-tree");
const rail = () => screen.getByTestId("pane-resize-git-history");

/**
 * Wiring only. The rail itself — separator semantics, drag, clamp, the hidden
 * rail on a phone — is owned by `useResizablePane.test.tsx` and
 * `PaneResizer.test.tsx`; the shared width and the inner scroller of all three
 * trees by `GitBranchDiff.resize.test.tsx`. What only this view can get wrong
 * is which edge, which key, which bounds, and whether it writes a width on a
 * phone.
 */
describe("resizing the git-history tree", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    stubFetch(GIT_ROUTES);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drags from the tree's inner edge, within TREE_BOUNDS, into the repo-tree key alone", async () => {
    const viewport = installMatchMedia();
    // A stored file-list width must not reach the tree...
    doc()[preferences.fileListPaneWidth.key] = 420;
    await renderTree();

    // The inner edge — the seam with the diff, not the window edge — inside
    // the sticky box, so the rail travels with it.
    expect(rail()).toHaveAttribute("data-edge", "right");
    expect(tree().contains(rail())).toBe(true);
    expect(tree()).toHaveStyle({ width: "280px" });
    // `shrink-0` stops the flex row squeezing the tree below the width the
    // hook thinks it has, or the rail jumps back on the next press.
    expect(tree().className).toMatch(/\bshrink-0\b/);

    // ...and dragging the tree must not reach the file list. Sharing one
    // declaration would fail one of these two whichever key it borrowed.
    dragBy(rail(), -40);
    expect(tree()).toHaveStyle({ width: "240px" });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(240);
    expect(readPreference(preferences.fileListPaneWidth)).toBe(420);

    dragBy(rail(), 600);
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.max);
    dragBy(rail(), -600);
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.min);

    // The tree is `hidden md:block`, so a px width on a phone would be a
    // desktop habit written onto a box it never shows, with no rail to undo it.
    viewport.setMobile(true);
    expect(tree().style.width).toBe("");
  });
});
