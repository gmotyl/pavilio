import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GitHistory from "../GitHistory";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";

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

const json = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/git/log")) return json(COMMITS);
      if (url.startsWith("/api/git/commit-files")) return json(FILES);
      if (url.startsWith("/api/git/diff")) return json({ diff: "" });
      return json(null);
    }),
  );
}

function stubMatchMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      matches: mobile,
      media: MOBILE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

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

/** Drag the rail by `dx` pixels and let go. */
function dragBy(dx: number) {
  const handle = rail();
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 + dx });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600 + dx });
}

describe("resizing the git-history tree", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    stubMatchMedia(false);
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the history tree renders a resize handle on desktop", async () => {
    await renderTree();
    const handle = rail();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    // The inner edge — the seam with the diff, not the window edge.
    expect(handle).toHaveAttribute("data-edge", "right");
    // `w-[280px]` is GONE rather than overridden: `useResizablePane` starts a
    // drag from React state, never a measurement, so a class still winning the
    // cascade would leave the rendered tree disagreeing with the reported one.
    expect(tree()).toHaveStyle({ width: "280px" });
    expect(tree().className).not.toMatch(/w-\[280px\]/);
    // `shrink-0` is the same guarantee from the other side: it stops the flex
    // row squeezing the tree below the width the hook thinks it has.
    expect(tree().className).toMatch(/\bshrink-0\b/);
  });

  it("dragging the handle changes and persists the width", async () => {
    await renderTree();
    dragBy(60);

    expect(tree()).toHaveStyle({ width: "340px" });
    expect(readPreference(preferences.gitHistoryPaneWidth)).toBe(340);
  });

  it("the drag stops at the widths this tree was given", async () => {
    await renderTree();
    dragBy(600);
    expect(tree()).toHaveStyle({ width: "480px" });
    expect(readPreference(preferences.gitHistoryPaneWidth)).toBe(480);

    dragBy(-600);
    expect(tree()).toHaveStyle({ width: "200px" });
    expect(readPreference(preferences.gitHistoryPaneWidth)).toBe(200);
  });

  it("the history tree width is independent of the file list width", async () => {
    // A stored file-list width must not reach the tree...
    doc()[preferences.fileListPaneWidth.key] = 420;
    await renderTree();
    expect(tree()).toHaveStyle({ width: "280px" });

    // ...and dragging the tree must not reach the file list. Sharing one
    // declaration would fail one of these two whichever key it borrowed.
    dragBy(-40);
    expect(tree()).toHaveStyle({ width: "240px" });
    expect(readPreference(preferences.fileListPaneWidth)).toBe(420);
    expect(readPreference(preferences.gitHistoryPaneWidth)).toBe(240);
  });

  it("no handle on a mobile viewport", async () => {
    stubMatchMedia(true);
    await renderTree();

    expect(screen.queryByTestId("pane-resize-git-history")).toBeNull();
    // And no width either. The tree is `hidden md:block`, so a px width here
    // would be a desktop habit written onto a box the phone never shows — and
    // with no rail there is nothing to undo it with.
    expect(tree().style.width).toBe("");
  });

  it("resizing does not disturb the sticky positioning", async () => {
    await renderTree();

    // No stylesheet is loaded in jsdom, so `position: sticky` cannot be read
    // back off the box. What can be pinned is everything the sticky DEPENDS
    // on, each of which swapping a width class for an inline width could
    // plausibly have taken away.
    expect(tree().className).toMatch(/\bsticky\b/);
    expect(tree().className).toMatch(/\btop-4\b/);
    // A flex item stretches by default, and a full-height item has no travel
    // to stick through.
    expect(tree().className).toMatch(/\bself-start\b/);
    // The rail is absolutely positioned, and `relative` is the reflex way to
    // give it a containing block — it would have replaced the sticky outright.
    // A sticky box is already positioned, so it is that containing block.
    expect(tree().className).not.toMatch(/\brelative\b/);
    expect(tree().style.position).toBe("");
    // Sticky resolves against the nearest scrolling ancestor, so an `overflow`
    // introduced on the row around it would trap the tree there instead.
    expect(tree().parentElement!.className).not.toMatch(/overflow/);
    // The rail lives inside the sticky box, so it travels with it.
    expect(tree().contains(rail())).toBe(true);

    // And a resize changes the width, nothing else.
    dragBy(40);
    expect(tree()).toHaveStyle({ width: "320px" });
    expect(tree().className).toMatch(/\bsticky\b/);
    expect(tree().className).toMatch(/\bself-start\b/);
    expect(tree().style.position).toBe("");
  });
});
