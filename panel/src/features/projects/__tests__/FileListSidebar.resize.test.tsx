import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileListSidebar from "../FileListSidebar";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { num } from "../../../preferences/codecs";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { definePreference } from "../../../preferences/types";

/**
 * The key Task 3 gives the git-history tree. Declared here rather than imported
 * because it does not exist yet — and that is the point of the independence
 * test: the file list must persist under a key of its own, so that the tree
 * landing later cannot start moving it.
 */
const historyPaneWidth = definePreference({
  key: "git.history.paneWidth",
  scope: "global",
  default: 280,
  codec: num,
  portable: true,
});

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

const sources = [
  { id: "project", label: "projects (current)", count: 2, rows: <p>rows</p> },
];

function renderSidebar() {
  return render(
    <FileListSidebar
      testId="plans-tab"
      title="Plans"
      sources={sources}
      detail={<p>the document</p>}
    />,
  );
}

const aside = () => screen.getByTestId("file-list-sidebar");
const rail = () => screen.getByTestId("pane-resize-file-list");

/** Drag the rail by `dx` pixels and let go. */
function dragBy(dx: number) {
  const handle = rail();
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 + dx });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600 + dx });
}

describe("resizing the file-list sidebar", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    stubMatchMedia(false);
  });

  it("the desktop file list renders a resize handle", () => {
    renderSidebar();
    const handle = rail();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    // The inner edge — the seam with the detail pane, not the window edge.
    expect(handle).toHaveAttribute("data-edge", "right");
    // `md:w-72` is gone: the width is the declared default, applied by the hook.
    expect(aside()).toHaveStyle({ width: "288px" });
    expect(aside().className).not.toMatch(/w-72/);
    // And `shrink-0` stays, which is the other half of the same guarantee: the
    // flex row must not squeeze the pane below the width the hook reports, or
    // the rail jumps back to that reported width on the next press.
    expect(aside().className).toMatch(/\bshrink-0\b/);
  });

  it("dragging the handle changes and persists the width", () => {
    renderSidebar();
    dragBy(60);

    expect(aside()).toHaveStyle({ width: "348px" });
    expect(readPreference(preferences.fileListPaneWidth)).toBe(348);
  });

  it("the drag stops at the widths this pane was given", () => {
    // The primitive's own tests pin the primitive's own bounds. Nothing yet
    // pinned THESE, so `PANE_BOUNDS` could be widened to anything and the
    // suite would stay green — including to a floor that leaves a column of
    // ellipses, or a ceiling that takes the detail pane's larger half.
    renderSidebar();
    dragBy(600);
    expect(aside()).toHaveStyle({ width: "560px" });
    expect(readPreference(preferences.fileListPaneWidth)).toBe(560);

    dragBy(-600);
    expect(aside()).toHaveStyle({ width: "200px" });
    expect(readPreference(preferences.fileListPaneWidth)).toBe(200);
  });

  it("collapsing and expanding restores the chosen width", () => {
    renderSidebar();
    dragBy(40);
    expect(aside()).toHaveStyle({ width: "328px" });

    // Collapse to the rail, then pin it open again. The width preference is
    // independent of the collapsed flag, so the list comes back as it was
    // rather than at the declared default.
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.queryByTestId("file-list-sidebar")).toBeNull();
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));

    expect(aside()).toHaveStyle({ width: "328px" });
  });

  it("the file list width is independent of the history tree width", () => {
    // A stored history-tree width must not reach the file list...
    doc()["git.history.paneWidth"] = 420;
    renderSidebar();
    expect(aside()).toHaveStyle({ width: "288px" });

    // ...and dragging the file list must not reach the history tree. Sharing
    // one declaration would fail one of these two whichever key it borrowed.
    dragBy(-50);
    expect(aside()).toHaveStyle({ width: "238px" });
    expect(readPreference(historyPaneWidth)).toBe(420);
    expect(readPreference(preferences.fileListPaneWidth)).toBe(238);
  });

  it("no handle on a mobile viewport", () => {
    stubMatchMedia(true);
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={sources}
        detail={<p>the document</p>}
      />,
    );
    // Mobile starts collapsed; expand it, so this is about the rail and not
    // about the list being absent.
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByText("rows")).toBeTruthy();
    expect(screen.queryByTestId("pane-resize-file-list")).toBeNull();
    // And no width either: the row stacks on mobile and the aside is
    // full-bleed, so a px width here would pin it to a desktop habit on a
    // phone — with no rail to undo it.
    expect(aside().style.width).toBe("");
  });
});
