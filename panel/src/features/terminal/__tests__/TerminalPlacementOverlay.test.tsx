import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalPlacementOverlay } from "../TerminalPlacementOverlay";
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

function renderOverlay(draggedId = "a") {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <TerminalPlacementOverlay
      layout={layout}
      draggedId={draggedId}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  );
  const overlay = screen.getByTestId("terminal-placement-overlay");
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    right: BOX.width,
    bottom: BOX.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return { overlay, onCommit, onCancel };
}

// jsdom has no DragEvent constructor, so Testing Library's dragOver helper drops
// clientX/clientY. Dispatch a MouseEvent of the same type instead: React dispatches
// synthetic handlers by event type, and the component guards the missing dataTransfer.
function dragOverAt(el: HTMLElement, clientX: number, clientY: number) {
  fireEvent(
    el,
    new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX, clientY }),
  );
}

function dropOn(el: HTMLElement) {
  fireEvent(el, new MouseEvent("drop", { bubbles: true, cancelable: true }));
}

const regionOf = (sessionId: string) =>
  screen.getByTestId(`placement-preview-${sessionId}`).getAttribute("data-region");

describe("TerminalPlacementOverlay", () => {
  it("paints a swap for a centre target", () => {
    const { overlay } = renderOverlay("a");

    // Centre of b: zone 9,3 of a tile spanning x 6..11, y 0..5.
    dragOverAt(overlay, 90, 30);

    expect(regionOf("a")).toBe("6,0,6,6");
    expect(regionOf("b")).toBe("0,0,6,12");
  });

  it("paints a split with the dragged session on top for a top-band target", () => {
    const { overlay } = renderOverlay("c");

    // Top edge of b: y just inside the tile, x at its centre.
    dragOverAt(overlay, 90, 1);

    expect(regionOf("c")).toBe("6,0,6,3");
    expect(regionOf("b")).toBe("6,3,6,9");
  });

  it("paints the bounding box and both displacements when sweeping two tiles", () => {
    const { overlay } = renderOverlay("a");

    dragOverAt(overlay, 90, 30); // over b
    dragOverAt(overlay, 90, 90); // and on into c

    expect(regionOf("a")).toBe("6,0,6,12");
    expect(regionOf("b")).toBe("0,0,6,6");
    expect(regionOf("c")).toBe("0,6,6,6");
  });

  it("commits the last painted layout on drop", () => {
    const { overlay, onCommit } = renderOverlay("a");

    dragOverAt(overlay, 90, 30);
    dropOn(overlay);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0][0] as TileLayout;
    expect(isValidLayout(committed)).toBe(true);
    expect(committed.find((t) => t.sessionId === "a")).toMatchObject({
      x: 6,
      y: 0,
      w: 6,
      h: 6,
    });
  });

  it("commits what was painted even when the pointer ends over the dragged cell", () => {
    const { overlay, onCommit } = renderOverlay("a");

    dragOverAt(overlay, 90, 30); // over b
    dragOverAt(overlay, 10, 30); // back over a itself
    dropOn(overlay);

    const committed = onCommit.mock.calls[0][0] as TileLayout;
    expect(committed.find((t) => t.sessionId === "a")).toMatchObject({ x: 6, y: 0 });
  });

  it("paints and commits nothing before any target is hovered", () => {
    const { overlay, onCommit, onCancel } = renderOverlay("a");

    dropOn(overlay);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("paints nothing for a target that cannot be repaired", () => {
    const onCommit = vi.fn();
    // Two sessions only: sweeping the single other tile is a swap, but a region
    // covering both leaves the dragged session's peers nowhere to go.
    const pair: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
      { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    render(
      <TerminalPlacementOverlay
        layout={pair}
        draggedId="a"
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId("terminal-placement-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      ...BOX,
      right: 120,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // A zone inside a's own tile is ignored, so nothing is ever painted.
    dragOverAt(overlay, 10, 60);
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("cancels on Escape leaving nothing painted", () => {
    const { overlay, onCancel } = renderOverlay("a");

    dragOverAt(overlay, 90, 30);
    expect(screen.queryByTestId("placement-preview-a")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByTestId("placement-preview-a")).toBeNull();
  });

  it("labels painted tiles with the session name when one is provided", () => {
    render(
      <TerminalPlacementOverlay
        layout={layout}
        draggedId="a"
        nameOf={(id) => `session-${id}`}
        onCommit={vi.fn()}
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

    dragOverAt(overlay, 90, 30);

    expect(screen.getByText("session-a")).toBeTruthy();
  });
});
