import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GitChanges from "../GitChanges";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { TREE_BOUNDS } from "../repoTree";

const FILES = [
  { status: "M", path: "src/a.ts" },
  { status: "??", path: "src/b.ts" },
];

const json = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/git/status")) return json(FILES);
      if (url.startsWith("/api/git/branch?")) return json({ branch: "main" });
      if (url.startsWith("/api/git/branches")) return json({ branches: [] });
      if (url.startsWith("/api/git/suggest-message"))
        return json({ suggestion: "" });
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
 * The one box in the tree that scrolls — found by its `overflow-y-auto`
 * wherever it currently sits, deliberately NOT by a test id. A test id would
 * have to be attached to whichever element the implementation chose, and the
 * thing worth pinning is exactly that choice.
 */
function scroller(): HTMLElement {
  const box = tree();
  const found = [box, ...box.querySelectorAll<HTMLElement>("*")].filter((el) =>
    el.classList.contains("overflow-y-auto"),
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** Drag the rail by `dx` pixels and let go. */
function dragBy(dx: number) {
  const handle = rail();
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 + dx });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600 + dx });
}

describe("resizing the git-changes tree", () => {
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

  it("renders the Changes tree without a hardcoded width class", async () => {
    await renderTree();
    // `w-[240px]` is GONE rather than overridden: `useResizablePane` starts a
    // drag from React state, never a measurement, so a class still winning the
    // cascade would leave the rendered tree disagreeing with the reported one.
    expect(tree().className).not.toMatch(/w-\[240px\]/);
    expect(tree()).toHaveStyle({
      width: `${preferences.repoTreePaneWidth.default}px`,
    });
    // `shrink-0` is the same guarantee from the other side: it stops the flex
    // row squeezing the tree below the width the hook thinks it has.
    expect(tree().className).toMatch(/\bshrink-0\b/);
    // The sticky survives the port. The rail is absolutely positioned and the
    // reflex fix — adding `relative` — would have REPLACED it; a sticky box is
    // already positioned, so it is the rail's containing block as it stands.
    expect(tree().className).toMatch(/\bsticky\b/);
    expect(tree().className).not.toMatch(/\brelative\b/);
  });

  it("renders a resize rail on the tree's inner edge", async () => {
    await renderTree();
    const handle = rail();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    // The inner edge — the seam with the diff, not the window edge.
    expect(handle).toHaveAttribute("data-edge", "right");
    // The rail lives inside the sticky box, so it travels with it.
    expect(tree().contains(handle)).toBe(true);
  });

  it("widens the Changes tree when the rail is dragged", async () => {
    await renderTree();
    dragBy(60);

    expect(tree()).toHaveStyle({
      width: `${preferences.repoTreePaneWidth.default + 60}px`,
    });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(
      preferences.repoTreePaneWidth.default + 60,
    );
  });

  it("clamps the Changes tree to the shared bounds", async () => {
    await renderTree();
    dragBy(600);
    expect(tree()).toHaveStyle({ width: `${TREE_BOUNDS.max}px` });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.max);

    dragBy(-600);
    expect(tree()).toHaveStyle({ width: `${TREE_BOUNDS.min}px` });
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(TREE_BOUNDS.min);
  });

  it("leaves the width unapplied on a narrow viewport", async () => {
    stubMatchMedia(true);
    await renderTree();

    expect(screen.queryByTestId("pane-resize-git-changes")).toBeNull();
    // And no width either. The tree is `hidden md:block`, so a px width here
    // would be a desktop habit written onto a box the phone never shows — and
    // with no rail there is nothing to undo it with.
    expect(tree().style.width).toBe("");
  });

  it("scrolls the inner container, not the aside, so the rail stays put", async () => {
    await renderTree();
    const box = scroller();

    // An absolute child of a SCROLL container scrolls away with the content, so
    // leaving the `overflow-y-auto` on the aside — the tidy-looking option —
    // makes the rail vanish the moment you scroll the tree.
    expect(box).not.toBe(tree());
    expect(tree().contains(box)).toBe(true);
    expect(tree().className).not.toMatch(/overflow/);

    // The cap moved in with the scrolling, and its number had to change to keep
    // the box the height it was: preflight's `box-sizing: border-box` meant the
    // aside's `calc(100vh-120px)` capped the BORDER box, whose content area was
    // 18px shorter (`p-2` twice, plus a 1px border twice). The inner div has
    // neither, so the same expression would have handed those 18px back.
    expect(box.className).toMatch(/\bmax-h-\[calc\(100vh-138px\)\]/);
    expect(tree().className).not.toMatch(/\bmax-h-/);
  });
});
