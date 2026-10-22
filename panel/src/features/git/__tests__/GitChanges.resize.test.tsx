import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GitChanges from "../GitChanges";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { TREE_BOUNDS } from "../repoTree";
import { dragBy, installMatchMedia, stubFetch } from "../../../test-utils";

const FILES = [
  { status: "M", path: "src/a.ts" },
  { status: "??", path: "src/b.ts" },
];

const GIT_ROUTES = {
  "/api/git/status": FILES,
  "/api/git/branch?": { branch: "main" },
  "/api/git/branches": { branches: [] },
  "/api/git/suggest-message": { suggestion: "" },
  "/api/git/diff": { diff: "" },
};

/**
 * The tree only exists beside an open diff, so the file is supplied through
 * `openFile` — the same way the router drives this component from `?file=` —
 * rather than clicked to first.
 */
async function renderTree() {
  const view = render(
    <GitChanges showListSidebar repo="/repo" openFile="src/a.ts" />,
  );
  await screen.findByTestId("git-changes-tree");
  return view;
}

const tree = () => screen.getByTestId("git-changes-tree");
const rail = () => screen.getByTestId("pane-resize-git-changes");

/**
 * Wiring only. The rail itself — separator semantics, drag, clamp, the hidden
 * rail on a phone — is owned by `useResizablePane.test.tsx` and
 * `PaneResizer.test.tsx`; the shared width and the inner scroller of all three
 * trees by `GitBranchDiff.resize.test.tsx`.
 */
describe("resizing the git-changes tree", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    stubFetch(GIT_ROUTES);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drags from the tree's inner edge, within TREE_BOUNDS, into the repo-tree key", async () => {
    const viewport = installMatchMedia();
    await renderTree();

    // The inner edge — the seam with the diff, not the window edge — inside
    // the sticky box, so the rail travels with it.
    expect(rail()).toHaveAttribute("data-edge", "right");
    expect(tree().contains(rail())).toBe(true);

    dragBy(rail(), 60);
    expect(tree()).toHaveStyle({ width: "340px" });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(340);

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
