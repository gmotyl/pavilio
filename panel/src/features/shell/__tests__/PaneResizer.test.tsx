import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { num } from "../../../preferences/codecs";
import { definePreference } from "../../../preferences/types";
import PaneResizer from "../PaneResizer";
import { useResizablePane, MOBILE_QUERY, type PaneBounds } from "../useResizablePane";

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

  it("no handle is rendered on a mobile viewport", () => {
    installMatchMedia(true);
    render(<Pane />);
    expect(screen.queryByTestId("pane-resize-files")).not.toBeInTheDocument();
    expect(screen.getByTestId("pane")).toBeInTheDocument();
  });
});
