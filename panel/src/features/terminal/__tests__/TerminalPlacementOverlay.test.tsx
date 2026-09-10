import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import {
  TerminalPlacementOverlay,
  type PlacementOverlayHandle,
} from "../TerminalPlacementOverlay";
import { GRID, isValidLayout, type TileLayout } from "../tileLayout";

// a on the left, b over c on the right — the shape from the bug report.
const layout: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
  { sessionId: "b", x: 24, y: 0, w: 24, h: 24 },
  { sessionId: "c", x: 24, y: 24, w: 24, h: 24 },
];

// 480x480 px over a 48x48 matrix: one zone is exactly 10px, so a client coordinate
// of 265,25 is zone 26,2 — inside b.
const BOX = { left: 0, top: 0, width: 480, height: 480 };

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
    act(() => handle.current!.over(395, 155));
    expect(screen.queryByTestId("placement-region")).toBeNull();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("grows the dragged window towards the pointer", () => {
    const { handle } = renderOverlay("a");

    // Pointer at zone 39,15 — the area anchored on a and stretched to it spans x 0..39.
    act(() => handle.current!.over(395, 155));

    expect(regionAim()).toBe("0,0,40,48");
    expect(regionOf("a")).toBe("0,0,40,48");
    // The others are re-tiled into what is left rather than losing their slot.
    expect(regionOf("b")).toBe("40,0,8,24");
    expect(regionOf("c")).toBe("40,24,8,24");
  });

  it("keeps the dragged window whole while the pointer stays inside it", () => {
    const { handle } = renderOverlay("b");

    // The area is anchored on the whole tile, not on a corner: grabbing the header and
    // wobbling inside your own window must not shave it into a strip.
    act(() => handle.current!.over(265, 25));

    expect(regionAim()).toBe("24,0,24,24");
  });

  it("takes the whole band when the sweep crosses a row of windows", () => {
    // Greg's 3x3 case: the top-left window swept to the right edge owns the top band.
    const rows: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 16, h: 16 },
      { sessionId: "b", x: 16, y: 0, w: 16, h: 16 },
      { sessionId: "c", x: 32, y: 0, w: 16, h: 16 },
      { sessionId: "d", x: 0, y: 16, w: 48, h: 32 },
    ];
    const { handle } = renderOverlay("a", true, rows);

    act(() => handle.current!.over(475, 155)); // zone 47,15 — far right of the top band

    expect(regionAim()).toBe("0,0,48,16");
    expect(regionOf("a")).toBe("0,0,48,16");
  });

  it("refuses a region that leaves the others nowhere to go", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(475, 475)); // the whole grid

    expect(regionAim()).toBe("0,0,48,48");
    // Painted as refused: the aim is drawn, the result is not.
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("swaps with the window under the pointer under Ctrl, wherever the pointer sits in it", () => {
    const { handle } = renderOverlay("a");

    // Deliberately near b's top edge: the plain exchange has no edge bands to miss.
    act(() => handle.current!.over(395, 5, "swap"));

    expect(regionOf("a")).toBe("24,0,24,24");
    expect(regionOf("b")).toBe("0,0,24,48");
    expect(screen.queryByTestId("placement-region")).toBeNull();
    // Only the whole window is offered, so there is nothing to aim past.
    expect(screen.getByTestId("placement-target-centre").getAttribute("data-region")).toBe(
      null,
    );
    expect(screen.queryByTestId("placement-target-top")).toBeNull();
  });

  it("swaps with the window under the pointer while the target modifier is held", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155, "target"));

    expect(regionOf("a")).toBe("24,0,24,24");
    expect(regionOf("b")).toBe("0,0,24,48");
    expect(screen.queryByTestId("placement-region")).toBeNull();
  });

  it("draws the targets of the hovered window while the modifier is held", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155, "target"));

    for (const side of ["centre", "left", "right", "top", "bottom"]) {
      expect(screen.getByTestId(`placement-target-${side}`)).toBeTruthy();
    }
    expect(
      screen.getByTestId("placement-target-centre").getAttribute("data-active"),
    ).toBe("true");
  });

  it("splits the hovered window when the modifier is held near its edge", () => {
    const { handle } = renderOverlay("c");

    act(() => handle.current!.over(395, 5, "target"));

    expect(regionOf("c")).toBe("24,0,24,12");
    expect(regionOf("b")).toBe("24,12,24,36");
  });

  it("clears the aim when the pointer has nothing to target", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155, "swap"));
    expect(screen.queryByTestId("placement-target-centre")).not.toBeNull();

    // Back over the dragged window itself: the previous window's targets must go, not
    // linger on screen as a stale aim.
    act(() => handle.current!.over(55, 155, "swap"));

    expect(screen.queryByTestId("placement-target-centre")).toBeNull();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("shows a legend of the modifiers, flagging the live one", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155));
    expect(screen.getByTestId("placement-legend")).toBeTruthy();
    expect(screen.getByTestId("placement-legend-grow").getAttribute("data-active")).toBe(
      "true",
    );
    expect(screen.getByTestId("placement-legend-swap").getAttribute("data-active")).toBe(
      "false",
    );

    act(() => handle.current!.over(395, 155, "swap"));
    expect(screen.getByTestId("placement-legend-swap").getAttribute("data-active")).toBe(
      "true",
    );

    act(() => handle.current!.over(395, 5, "target"));
    expect(
      screen.getByTestId("placement-legend-target").getAttribute("data-active"),
    ).toBe("true");
  });

  it("the legend lists the unmodified gesture first", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155));
    const legend = screen.getByTestId("placement-legend");

    // Reading order follows how often the gesture is reached for: the unmodified
    // target drag, then Shift to grow, then Ctrl to swap.
    expect(
      Array.from(legend.children).map((row) => row.getAttribute("data-testid")),
    ).toEqual([
      "placement-legend-target",
      "placement-legend-grow",
      "placement-legend-swap",
    ]);
    expect(
      Array.from(legend.querySelectorAll("kbd")).map((k) => k.textContent),
    ).toEqual(["Drag", "Shift", "Ctrl"]);
  });

  it("hides the legend once the gesture ends", () => {
    const { handle } = renderOverlay("a");
    act(() => handle.current!.over(395, 155));
    act(() => handle.current!.end());
    expect(screen.queryByTestId("placement-legend")).toBeNull();
  });

  it("draws the zone grid while a gesture is running", () => {
    const { handle } = renderOverlay("a");
    act(() => handle.current!.over(395, 155));
    expect(screen.getByTestId("placement-zone-grid")).toBeTruthy();
  });

  it("the zone substrate draws one line every four zones", () => {
    const { handle } = renderOverlay("a");
    act(() => handle.current!.over(395, 155));

    // A line per zone would be 48 of them on each axis — a haze, not a substrate.
    // The stride keeps the spacing the eye already knows from the 12-zone matrix.
    const spacing = `${(4 / GRID) * 100}%`;
    const image = screen.getByTestId("placement-zone-grid").style.backgroundImage;

    expect(image.split(spacing)).toHaveLength(3); // once per axis
  });

  it("returns the painted layout from release and disarms", () => {
    const { handle } = renderOverlay("a");

    act(() => handle.current!.over(395, 155));
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

    act(() => handle.current!.over(395, 155));
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
      right: 480,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => handle.current!.begin("a"));
    act(() => handle.current!.over(395, 155));

    expect(screen.getByText("session-a")).toBeTruthy();
  });
});
