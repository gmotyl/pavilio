import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { num } from "../../../preferences/codecs";
import { definePreference } from "../../../preferences/types";
import PaneResizer from "../PaneResizer";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { useResizablePane, type PaneBounds } from "../useResizablePane";
import { useResizableRow, type RowBounds } from "../useResizableRow";

/** Controllable matchMedia stub — jsdom has none. */
function installMatchMedia(mobile: boolean) {
  const mql = {
    matches: mobile,
    media: MOBILE_QUERY,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => mql,
  });
}

const paneWidth = definePreference({
  key: "test.pane.width",
  scope: "global",
  default: 320,
  codec: num,
  portable: true,
});

const BOUNDS: PaneBounds = { min: 200, max: 600, step: 16 };

function Pane({ edge = "right" }: { edge?: "left" | "right" }) {
  const { width, handleProps } = useResizablePane(paneWidth, BOUNDS);
  return (
    <aside data-testid="pane" style={{ width: `${width}px` }}>
      <PaneResizer name="files" edge={edge} label="Resize the file list" {...handleProps} />
      <span data-testid="width">{width}</span>
    </aside>
  );
}

const rowHeight = definePreference({
  key: "test.row.height",
  scope: "global",
  default: 140,
  codec: num,
  portable: true,
});

const ROW_BOUNDS: RowBounds = { min: 96, max: 320, step: 24 };

/** The other axis: a rail on a row's top edge, driven by `useResizableRow`. */
function Row() {
  const { height, handleProps } = useResizableRow(rowHeight, ROW_BOUNDS);
  return (
    <section data-testid="row" style={{ height: `${height}px` }}>
      <PaneResizer name="composer" edge="top" label="Resize the composer" {...handleProps} />
    </section>
  );
}

/**
 * The other side of the same axis: a rail on a row's BOTTOM edge, which is
 * what the answer pane hangs off. Horizontal like the composer's, and driven
 * by the same hook — the difference is only which end of the row it sits on
 * and, because of that, which way a drag has to travel to shorten it.
 */
function BottomRow() {
  const { height, handleProps } = useResizableRow(rowHeight, ROW_BOUNDS);
  return (
    <section data-testid="row" style={{ height: `${height}px` }}>
      <PaneResizer name="pane" edge="bottom" label="Resize the answer pane" {...handleProps} />
    </section>
  );
}

const rail = () => screen.getByTestId("pane-resize-files");

describe("PaneResizer", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    installMatchMedia(false);
  });

  it("renders a focusable vertical separator carrying the pane's bounds", () => {
    render(<Pane />);
    const handle = rail();
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-label", "Resize the file list");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-valuenow", "320");
    expect(handle).toHaveAttribute("aria-valuemin", "200");
    expect(handle).toHaveAttribute("aria-valuemax", "600");
  });

  it("puts the rail on the edge it was given", () => {
    const right = render(<Pane />);
    expect(rail()).toHaveAttribute("data-edge", "right");
    right.unmount();

    render(<Pane edge="left" />);
    expect(rail()).toHaveAttribute("data-edge", "left");
  });

  it("captures the pointer and resizes the pane as it is dragged", () => {
    render(<Pane />);
    const handle = rail();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 });
    expect(vi.mocked(Element.prototype.setPointerCapture)).toHaveBeenCalledWith(1);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 });
    expect(screen.getByTestId("pane")).toHaveStyle({ width: "380px" });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 460 });
    expect(screen.getByTestId("width").textContent).toBe("380");
  });

  it("a rail on the left edge grows the pane when dragged leftward", () => {
    // The inversion lives in `growDirection`, which reads the rail's own
    // `data-edge` — so it is only really exercised through a rail that renders
    // that attribute itself, rather than a probe that hand-writes it.
    render(<Pane edge="left" />);
    const handle = rail();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 });
    expect(screen.getByTestId("pane")).toHaveStyle({ width: "380px" });

    // ...and rightward shrinks it, which is the half a sign-agnostic
    // implementation would still get right by accident.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 460 });
    expect(screen.getByTestId("pane")).toHaveStyle({ width: "260px" });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 460 });
    expect(screen.getByTestId("width").textContent).toBe("260");
  });

  it("renders a horizontal rail for the top edge", () => {
    render(<Row />);
    const handle = screen.getByTestId("pane-resize-composer");

    // The axis is what a screen reader is told, and what `growDirection` reads
    // back off the element to decide which way a drag grows the row.
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle).toHaveAttribute("data-edge", "top");
    expect(handle).toHaveAttribute("aria-label", "Resize the composer");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-valuenow", "140");
    expect(handle).toHaveAttribute("aria-valuemin", "96");
    expect(handle).toHaveAttribute("aria-valuemax", "320");

    // A bar across the row, not a column beside it.
    expect(handle.className).toContain("cursor-row-resize");
    expect(handle.className).toContain("w-full");
    expect(handle.className).not.toContain("cursor-col-resize");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 460 });
    expect(screen.getByTestId("row")).toHaveStyle({ height: "180px" });
  });

  it("renders a horizontal rail for the bottom edge", () => {
    render(<BottomRow />);
    const handle = screen.getByTestId("pane-resize-pane");

    // The axis a screen reader is told about is the one the bar lies along,
    // which is the same for both ends of a row — `top` and `bottom` are one
    // question (horizontal or vertical) and `data-edge` is the other (which
    // end), and it is `data-edge` that `growDirection` reads back.
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle).toHaveAttribute("data-edge", "bottom");
    expect(handle).toHaveAttribute("aria-label", "Resize the answer pane");
    expect(handle).toHaveAttribute("tabindex", "0");
    expect(handle).toHaveAttribute("aria-valuenow", "140");
    expect(handle).toHaveAttribute("aria-valuemin", "96");
    expect(handle).toHaveAttribute("aria-valuemax", "320");

    // A bar across the row, as on the top edge...
    expect(handle.className).toContain("cursor-row-resize");
    expect(handle.className).toContain("w-full");
    expect(handle.className).toContain("h-2");
    expect(handle.className).not.toContain("cursor-col-resize");
    // ...and pinned to the end of the row it actually borders. A rail that
    // announced `bottom` and rendered at `top-0` would drag the right way and
    // sit in the wrong place, which is the one failure the geometry above
    // cannot catch on its own.
    expect(handle.className).toContain("bottom-0");
    expect(handle.className).not.toContain("top-0");
  });

  it("shrinks the pane when a bottom-edge drag moves the pointer up", () => {
    render(<BottomRow />);
    const handle = screen.getByTestId("pane-resize-pane");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    // Up the screen is a falling clientY, and on the bottom edge that takes
    // the row's own bottom with it: 40px up is 40px shorter.
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 460 });
    expect(screen.getByTestId("row")).toHaveStyle({ height: "100px" });

    // ...and downward grows it, which is the half a sign-agnostic
    // implementation would still get right by accident.
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 540 });
    expect(screen.getByTestId("row")).toHaveStyle({ height: "180px" });

    // Clamped at the floor rather than following the pointer past it.
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 });
    expect(screen.getByTestId("row")).toHaveStyle({ height: "96px" });

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
  });

  it("no handle is rendered on a mobile viewport", () => {
    installMatchMedia(true);
    render(<Pane />);
    expect(screen.queryByTestId("pane-resize-files")).not.toBeInTheDocument();
    expect(screen.getByTestId("pane")).toBeInTheDocument();
  });
});
