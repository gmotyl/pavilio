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

  it("no handle is rendered on a mobile viewport", () => {
    installMatchMedia(true);
    render(<Pane />);
    expect(screen.queryByTestId("pane-resize-files")).not.toBeInTheDocument();
    expect(screen.getByTestId("pane")).toBeInTheDocument();
  });
});
