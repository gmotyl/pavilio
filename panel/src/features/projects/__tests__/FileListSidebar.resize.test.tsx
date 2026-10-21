import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileListSidebar from "../FileListSidebar";
import { preferences } from "../../../preferences/declarations";
import { readPreference } from "../../../preferences/store";
import { dragBy, installMatchMedia } from "../../../test-utils";

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

/**
 * Wiring only. The rail itself — separator semantics, drag, clamp, the hidden
 * rail on a phone — is owned by `useResizablePane.test.tsx` and
 * `PaneResizer.test.tsx`. What only this pane can get wrong is which edge,
 * which key, which bounds, the collapse, and whether it writes a width on a
 * phone.
 */
describe("resizing the file-list sidebar", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("drags from the list's inner edge, within its own bounds, into the file-list key alone", () => {
    const viewport = installMatchMedia();
    // A stored history-tree width must not reach the file list...
    doc()[preferences.repoTreePaneWidth.key] = 420;
    renderSidebar();

    // The inner edge — the seam with the detail pane, not the window edge.
    expect(rail()).toHaveAttribute("data-edge", "right");
    // `md:w-72` is gone: the width is the declared default, applied by the
    // hook. `shrink-0` stays, or the flex row squeezes the pane below the
    // width the hook reports and the rail jumps back on the next press.
    expect(aside()).toHaveStyle({ width: "288px" });
    expect(aside().className).not.toMatch(/w-72/);
    expect(aside().className).toMatch(/\bshrink-0\b/);

    // ...and dragging the file list must not reach the history tree.
    dragBy(rail(), -50);
    expect(aside()).toHaveStyle({ width: "238px" });
    expect(readPreference(preferences.fileListPaneWidth)).toBe(238);
    expect(readPreference(preferences.repoTreePaneWidth)).toBe(420);

    // The primitive's own tests pin the primitive's bounds; these pin
    // `PANE_BOUNDS`, which could otherwise widen to anything unnoticed.
    dragBy(rail(), 600);
    expect(readPreference(preferences.fileListPaneWidth)).toBe(560);
    dragBy(rail(), -600);
    expect(readPreference(preferences.fileListPaneWidth)).toBe(200);

    // On a phone the row stacks and the aside is full-bleed, so a px width
    // would pin it to a desktop habit — with no rail to undo it.
    // Going mobile collapses the list; expand it, so this is about the width
    // and not about the list being absent.
    viewport.setMobile(true);
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByText("rows")).toBeTruthy();
    expect(aside().style.width).toBe("");
  });

  it("collapsing and expanding restores the chosen width", () => {
    installMatchMedia();
    renderSidebar();
    dragBy(rail(), 40);
    expect(aside()).toHaveStyle({ width: "328px" });

    // Collapse to the rail, then pin it open again. The width preference is
    // independent of the collapsed flag, so the list comes back as it was
    // rather than at the declared default.
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.queryByTestId("file-list-sidebar")).toBeNull();
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));

    expect(aside()).toHaveStyle({ width: "328px" });
  });
});
