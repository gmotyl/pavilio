import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import {
  TerminalPlacementOverlay,
  type PlacementOverlayHandle,
} from "../TerminalPlacementOverlay";
import { isValidLayout, type TileLayout } from "../tileLayout";

// a on the left, b over c on the right — the shape from the bug report.
const layout: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
  { sessionId: "b", x: 6, y: 0, w: 6, h: 6 },
  { sessionId: "c", x: 6, y: 6, w: 6, h: 6 },
];

// 120x120 px over a 12x12 matrix: one zone is exactly 10px, so a client coordinate
// of 65,30 is zone 6.5,3 — the middle of b.
const BOX = { left: 0, top: 0, width: 120, height: 120 };

function renderOverlay(draggedId = "a", begin = true, custom = layout) {
  const onCancel = vi.fn();
  const handle = createRef<PlacementOverlayHandle>();
  render(
    <TerminalPlacementOverlay ref={handle} layout={custom} onCancel={onCancel} />,
  );
  const overlay = screen.getByTestId("terminal-placement-overlay");
  if (begin) act(() => handle.current!.begin(draggedId));
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    right: BOX.width,
    bottom: BOX.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return { overlay, onCancel, handle };
}

const regionOf = (sessionId: string) =>
  screen.getByTestId(`placement-preview-${sessionId}`).getAttribute("data-region");

const regionAim = () =>
  screen.getByTestId("placement-region").getAttribute("data-region");

describe("TerminalPlacementOverlay", () => {
  it("is mounted from the first render and never hittable", () => {
    const { overlay } = renderOverlay("a", false);

    // Both matter: mounting it at dragstart, or arming it by taking pointer events,
    // changes the DOM under the cursor mid-dragstart and Chromium kills the drag.
    expect(overlay).toBeTruthy();
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("paints nothing until a gesture begins", () => {
    const { handle } = renderOverlay("a", false);
    act(() => handle.current!.over(90, 30));
    expect(screen.queryByTestId("placement-region")).toBeNull();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("grows the dragged window towards the pointer", () => {
    const { handle } = renderOverlay("a");

    // Pointer at zone 9,3 — the area anchored on a and stretched to it spans x 0..9.
    act(() => handle.current!.over(90, 30));

    expect(regionAim()).toBe("0,0,10,12");
    expect(regionOf("a")).toBe("0,0,10,12");
    // The others are re-tiled into what is left rather than losing their slot.
    expect(regionOf("b")).toBe("10,0,2,6");
    expect(regionOf("c")).toBe("10,6,2,6");
  });

  it("keeps the dragged window whole while the pointer stays inside it", () => {
    const { handle } = renderOverlay("b");

    // The area is anchored on the whole tile, not on a corner: grabbing the header and
    // wobbling inside your own window must not shave it into a strip.
    act(() => handle.current!.over(65, 5));

    expect(regionAim()).toBe("6,0,6,6");
  });

  it("takes the whole band when the sweep crosses a row of windows", () => {
    // Greg's 3x3 case: the top-left window swept to the right edge owns the top band.
    const rows: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 4, h: 4 },
      { sessionId: "b", x: 4, y: 0, w: 4, h: 4 },
      { sessionId: "c", x: 8, y: 0, w: 4, h: 4 },
      { sessionId: "d", x: 0, y: 4, w: 12, h: 8 },
    ];
    const { handle } = renderOverlay("a", true, rows);

    act(() => handle.current!.over(115, 30)); // zone 11,3 — far right of the top band

    expect(regionAim()).toBe("0,0,12,4");
    expect(regionOf("a")).toBe("0,0,12,4");
  });

  it("refuses a region that leaves the others nowhere to go", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(119, 119)); // the whole grid

    expect(regionAim()).toBe("0,0,12,12");
    // Painted as refused: the aim is drawn, the result is not.
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("swaps with the window under the pointer while the modifier is held", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30, true));

    expect(regionOf("a")).toBe("6,0,6,6");
    expect(regionOf("b")).toBe("0,0,6,12");
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("draws the targets of the hovered window while the modifier is held", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30, true));

    for (const side of ["centre", "left", "right", "top", "bottom"]) {
      expect(screen.getByTestId(`placement-target-${side}`)).toBeTruthy();
    }
    expect(
      screen.getByTestId("placement-target-centre").getAttribute("data-active"),
    ).toBe("true");
  });

  it("splits the hovered window when the modifier is held near its edge", () => {
    const { handle } = renderOverlay("c");

    act(() => handle.current!.over(90, 1, true));

    expect(regionOf("c")).toBe("6,0,6,3");
    expect(regionOf("b")).toBe("6,3,6,9");
  });

  it("draws the zone grid while a gesture is running", () => {
    const { handle } = renderOverlay("a");
    act(() => handle.current!.over(90, 30));
    expect(screen.getByTestId("placement-zone-grid")).toBeTruthy();
  });

  it("returns the painted layout from release and disarms", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30));
    let committed: TileLayout | null = null;
    act(() => {
      committed = handle.current!.release();
    });

    expect(committed).not.toBeNull();
    expect(isValidLayout(committed!)).toBe(true);
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("releases nothing when the gesture never left the dragged window", () => {
    const { handle } = renderOverlay("a");

    let committed: TileLayout | null = null;
    act(() => {
      committed = handle.current!.release();
    });

    expect(committed).toBeNull();
  });

  it("cancels on Escape leaving nothing painted", () => {
    const { handle, onCancel } = renderOverlay("a");

    act(() => handle.current!.over(90, 30));
    expect(screen.queryByTestId("placement-region")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("labels painted tiles with the session name when one is provided", () => {
    const handle = createRef<PlacementOverlayHandle>();
    render(
      <TerminalPlacementOverlay
        ref={handle}
        layout={layout}
        nameOf={(id) => `session-${id}`}
        onCancel={vi.fn()}
      />,
    );
    const overlay = screen.getAllByTestId("terminal-placement-overlay")[0];
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      ...BOX,
      right: 120,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => handle.current!.begin("a"));
    act(() => handle.current!.over(90, 30));

    expect(screen.getByText("session-a")).toBeTruthy();
  });
});
