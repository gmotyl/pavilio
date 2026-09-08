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

describe("TerminalPlacementOverlay", () => {
  it("is mounted from the first render and never hittable", () => {
    const { overlay } = renderOverlay("a", false);

    // Both matter: mounting it at dragstart, or arming it by taking pointer events,
    // changes the DOM under the cursor mid-dragstart and Chromium kills the drag.
    expect(overlay).toBeTruthy();
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("paints nothing until a gesture begins", () => {
    const { overlay, handle } = renderOverlay("a", false);
    act(() => handle.current!.over(90, 30));
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
    expect(overlay.style.pointerEvents).toBe("none");
  });

  it("paints a swap for a centre target", () => {
    const { handle } = renderOverlay("a");

    // Centre of b: zone 9,3 of a tile spanning x 6..11, y 0..5.
    act(() => handle.current!.over(90, 30));

    expect(regionOf("a")).toBe("6,0,6,6");
    expect(regionOf("b")).toBe("0,0,6,12");
  });

  it("paints a split with the dragged session on top for a top-band target", () => {
    const { handle } = renderOverlay("c");

    act(() => handle.current!.over(90, 1));

    expect(regionOf("c")).toBe("6,0,6,3");
    expect(regionOf("b")).toBe("6,3,6,9");
  });

  it("aims only at the window under the pointer, whatever route it took", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30)); // across b …
    act(() => handle.current!.over(90, 90)); // … and on to c

    // The route must not eat the target: passing over b on the way to c used to make
    // the region their bounding box, which is why swapping two far-apart windows was
    // impossible.
    expect(regionOf("a")).toBe("6,6,6,6");
    // c takes the rectangle a vacated; b, merely passed over, is untouched.
    expect(regionOf("c")).toBe("0,0,6,12");
    expect(regionOf("b")).toBe("6,0,6,6");
  });

  it("merges the windows swept while the modifier is held", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30, true));
    act(() => handle.current!.over(90, 90, true));

    expect(regionOf("a")).toBe("6,0,6,12");
    expect(regionOf("b")).toBe("0,0,6,6");
    expect(regionOf("c")).toBe("0,6,6,6");
  });

  it("draws the targets of the window under the pointer", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30));

    // Five aim-able regions, the chosen one flagged — the affordance that was missing
    // when the model only painted its result.
    for (const side of ["centre", "left", "right", "top", "bottom"]) {
      expect(screen.getByTestId(`placement-target-${side}`)).toBeTruthy();
    }
    expect(
      screen.getByTestId("placement-target-centre").getAttribute("data-active"),
    ).toBe("true");
    expect(screen.getByTestId("placement-zone-grid")).toBeTruthy();
  });

  it("flags the edge band as the target when the pointer is near an edge", () => {
    const { handle } = renderOverlay("c");

    act(() => handle.current!.over(90, 1));

    expect(
      screen.getByTestId("placement-target-top").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("placement-target-centre").getAttribute("data-active"),
    ).toBe("false");
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
    expect(committed!.find((t) => t.sessionId === "a")).toMatchObject({
      x: 6,
      y: 0,
      w: 6,
      h: 6,
    });
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("keeps the painted target when the pointer passes back over the dragged cell", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(90, 30)); // over b
    act(() => handle.current!.over(10, 30)); // back over a itself
    let committed: TileLayout | null = null;
    act(() => {
      committed = handle.current!.release();
    });

    expect(committed!.find((t) => t.sessionId === "a")).toMatchObject({ x: 6, y: 0 });
  });

  it("releases nothing when no target was ever hovered", () => {
    const { handle } = renderOverlay("a");

    let committed: TileLayout | null = null;
    act(() => {
      committed = handle.current!.release();
    });

    expect(committed).toBeNull();
  });

  it("paints nothing for a target that cannot be repaired", () => {
    // Two sessions: a region covering both leaves the displaced one nowhere to go.
    const pair: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
      { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    const { handle } = renderOverlay("a", true, pair);

    // A coordinate inside a's own tile is ignored, so nothing is ever painted.
    act(() => handle.current!.over(10, 60));

    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("cancels on Escape leaving nothing painted", () => {
    const { handle, onCancel } = renderOverlay("a");

    act(() => handle.current!.over(90, 30));
    expect(screen.queryByTestId("placement-preview-a")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
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
