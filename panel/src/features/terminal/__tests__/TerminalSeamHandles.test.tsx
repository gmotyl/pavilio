// The seam handles component: one grab strip per seam, and the pointer-driven
// drag lifecycle around it — draft on every move, one commit on release, and
// nothing at all when the gesture is abandoned.
//
// jsdom has PointerEvent but no pointer capture (setPointerCapture is undefined),
// so the capture call is asserted through a stub and the drag itself is driven by
// events on the window, which is where the component listens.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { TerminalSeamHandles } from "../TerminalSeamHandles";
import type { TileLayout } from "../tileLayout";

// Two tiles side by side: exactly one seam, vertical, at zone 24 over the full height.
const SPLIT: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
  { sessionId: "b", x: 24, y: 0, w: 24, h: 48 },
];

// The design's §3.1 figure: the vertical line at 24 carries a seam only over the
// top half, and a different vertical boundary sits at 12 over the bottom half.
const PARTIAL: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 24, h: 24 },
  { sessionId: "d", x: 24, y: 0, w: 24, h: 24 },
  { sessionId: "b", x: 0, y: 24, w: 12, h: 24 },
  { sessionId: "c", x: 12, y: 24, w: 36, h: 24 },
];

const SINGLE: TileLayout = [{ sessionId: "only", x: 0, y: 0, w: 48, h: 48 }];

// 476 + the 4px gutter = 480, so one zone is exactly 10px and pixel deltas in the
// tests convert to zone deltas without rounding noise.
const BOX = { width: 476, height: 476 };

function tile(layout: TileLayout, sessionId: string) {
  const found = layout.find((t) => t.sessionId === sessionId);
  if (!found) throw new Error(`no tile for ${sessionId}`);
  return found;
}

// `Array.prototype.at` is outside the project's lib target, so read the last call
// by index.
function lastDraft(onDraft: Mock): TileLayout | null {
  const { calls } = onDraft.mock;
  return calls[calls.length - 1][0] as TileLayout | null;
}

function handles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid^="seam-handle-"]'));
}

function setup(layout: TileLayout) {
  const onResize = vi.fn();
  const onDraft = vi.fn();
  const view = render(
    <TerminalSeamHandles layout={layout} onResize={onResize} onDraft={onDraft} box={BOX} />,
  );
  return { ...view, onResize, onDraft };
}

// Grabs the vertical seam of SPLIT and presses at its centre.
function grabSplitSeam() {
  const harness = setup(SPLIT);
  const handle = screen.getByTestId("seam-handle-x-24-0");
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 240, clientY: 240 });
  return { ...harness, handle };
}

describe("TerminalSeamHandles", () => {
  it("renders one handle per seam, on its own segment", () => {
    const { container } = setup(PARTIAL);

    expect(handles(container)).toHaveLength(3);

    const upper = screen.getByTestId("seam-handle-x-24-0");
    expect(upper.style.left).toBe("calc(-2px + 0.5 * (100% + 4px))");
    expect(upper.style.transform).toBe("translateX(-50%)");
    expect(upper.style.width).toBe("9px");
    expect(upper.style.top).toBe("0%");
    expect(upper.style.height).toBe("50%");
    expect(upper.style.cursor).toBe("col-resize");
    expect(upper.style.touchAction).toBe("none");

    // The lower vertical boundary sits elsewhere and covers only the bottom half.
    const lower = screen.getByTestId("seam-handle-x-12-24");
    expect(lower.style.left).toBe("calc(-2px + 0.25 * (100% + 4px))");
    expect(lower.style.top).toBe("50%");
    expect(lower.style.height).toBe("50%");

    const horizontal = screen.getByTestId("seam-handle-y-24-0");
    expect(horizontal.style.top).toBe("calc(-2px + 0.5 * (100% + 4px))");
    expect(horizontal.style.transform).toBe("translateY(-50%)");
    expect(horizontal.style.height).toBe("9px");
    expect(horizontal.style.left).toBe("0%");
    expect(horizontal.style.width).toBe("100%");
    expect(horizontal.style.cursor).toBe("row-resize");
  });

  it("a pointerdown captures the pointer", () => {
    setup(SPLIT);
    const handle = screen.getByTestId("seam-handle-x-24-0");
    const capture = vi.fn();
    handle.setPointerCapture = capture;

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 240, clientY: 240 });

    expect(capture).toHaveBeenCalledWith(7);
  });

  it("dragging reports drafts and does not persist", () => {
    const { onDraft, onResize } = grabSplitSeam();

    // +100px is +10 zones on a 10px zone.
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 340, clientY: 240 });

    const draft = lastDraft(onDraft) as TileLayout;
    expect(tile(draft, "a")).toMatchObject({ x: 0, w: 34 });
    expect(tile(draft, "b")).toMatchObject({ x: 34, w: 14 });
    expect(onResize).not.toHaveBeenCalled();

    // Dragged past the limit, the boundary holds at MIN_SPAN rather than running on.
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 1240, clientY: 240 });

    const clamped = lastDraft(onDraft) as TileLayout;
    expect(tile(clamped, "a")).toMatchObject({ x: 0, w: 44 });
    expect(tile(clamped, "b")).toMatchObject({ x: 44, w: 4 });
    expect(onResize).not.toHaveBeenCalled();

    // Dragged back to where it started there is nothing to move, and the draft is
    // the original boundary rather than nothing at all.
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 240, clientY: 240 });

    const home = lastDraft(onDraft) as TileLayout;
    expect(tile(home, "a")).toMatchObject({ x: 0, w: 24 });
    expect(tile(home, "b")).toMatchObject({ x: 24, w: 24 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("releasing persists exactly once", () => {
    const { onDraft, onResize } = grabSplitSeam();

    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300, clientY: 240 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 340, clientY: 240 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 340, clientY: 240 });

    expect(onResize).toHaveBeenCalledTimes(1);
    const committed = onResize.mock.calls[0][0] as TileLayout;
    expect(tile(committed, "a")).toMatchObject({ x: 0, w: 34 });
    expect(tile(committed, "b")).toMatchObject({ x: 34, w: 14 });
    // The draft is cleared, so the grid renders the committed layout again.
    expect(lastDraft(onDraft)).toBeNull();

    // The drag is over: later pointer traffic changes nothing.
    onDraft.mockClear();
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 400, clientY: 240 });
    expect(onDraft).not.toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledTimes(1);

    // A press that never moved is not a resize, so releasing it persists nothing.
    const handle = screen.getByTestId("seam-handle-x-24-0");
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 240, clientY: 240 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 240, clientY: 240 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("the drag survives the pointer leaving the handle", () => {
    const { onDraft, onResize } = grabSplitSeam();

    // Well outside the thin strip, and off the grid entirely.
    fireEvent.pointerMove(document.body, { pointerId: 3, clientX: 380, clientY: 9000 });

    const draft = lastDraft(onDraft) as TileLayout;
    expect(tile(draft, "a")).toMatchObject({ x: 0, w: 38 });

    fireEvent.pointerUp(document.body, { pointerId: 3, clientX: 380, clientY: 9000 });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(tile(onResize.mock.calls[0][0] as TileLayout, "a")).toMatchObject({ w: 38 });
  });

  it("Escape restores the pre-drag layout and persists nothing", () => {
    const { onDraft, onResize } = grabSplitSeam();

    fireEvent.pointerMove(window, { pointerId: 3, clientX: 340, clientY: 240 });
    expect(lastDraft(onDraft)).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(lastDraft(onDraft)).toBeNull();
    expect(onResize).not.toHaveBeenCalled();

    // The gesture is abandoned, not paused: releasing afterwards persists nothing.
    onDraft.mockClear();
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 400, clientY: 240 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 400, clientY: 240 });
    expect(onDraft).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("pointercancel abandons the drag", () => {
    const { onDraft, onResize } = grabSplitSeam();

    fireEvent.pointerMove(window, { pointerId: 3, clientX: 340, clientY: 240 });
    fireEvent.pointerCancel(window, { pointerId: 3, clientX: 340, clientY: 240 });

    expect(lastDraft(onDraft)).toBeNull();
    expect(onResize).not.toHaveBeenCalled();

    onDraft.mockClear();
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 400, clientY: 240 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 400, clientY: 240 });
    expect(onDraft).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("the handle layer lets pointer traffic through to the grid beneath", () => {
    const { container } = setup(SPLIT);

    // The layer is `absolute inset-0`, so it covers every cell in the grid. It must
    // therefore take no pointer events of its own: without `pointer-events-none`
    // here the whole grid stops being clickable, and the strips are the only thing
    // that should be hittable. jsdom runs no Tailwind and does no hit testing, so
    // the contract is pinned on the class list rather than on a synthetic click.
    const layer = container.firstElementChild as HTMLElement;
    const classes = layer.className.split(" ");
    expect(classes).toContain("absolute");
    expect(classes).toContain("inset-0");
    expect(classes).toContain("pointer-events-none");

    // ...and the strips re-enable it, or there would be no gesture at all.
    for (const handle of handles(container)) {
      expect(handle.className.split(" ")).toContain("pointer-events-auto");
    }
  });

  it("a jiggle inside one zone persists nothing", () => {
    const { onDraft, onResize } = grabSplitSeam();

    // 3px on a 10px zone rounds to a zero-zone move, so the boundary never went
    // anywhere. The draft falls back to the snapshot to hold the boundary still,
    // and releasing must not write that snapshot back: doing so materialises a
    // custom layout for the scope and stops the per-count default re-applying.
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 243, clientY: 240 });

    const draft = lastDraft(onDraft) as TileLayout;
    expect(tile(draft, "a")).toMatchObject({ x: 0, w: 24 });

    fireEvent.pointerUp(window, { pointerId: 3, clientX: 243, clientY: 240 });

    expect(onResize).not.toHaveBeenCalled();
  });

  it("unmounting mid-drag clears the draft", () => {
    const { onDraft, onResize, unmount } = grabSplitSeam();

    fireEvent.pointerMove(window, { pointerId: 3, clientX: 340, clientY: 240 });
    expect(lastDraft(onDraft)).not.toBeNull();

    // The handles go away for reasons other than release — the session count drops
    // to 1, a terminal is maximized — and the draft lives in the grid above them.
    // Leaving it behind renders a tiling nobody committed.
    unmount();

    expect(lastDraft(onDraft)).toBeNull();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("a single-tile layout renders no handles", () => {
    const { container } = setup(SINGLE);

    expect(handles(container)).toHaveLength(0);
    // Not even an empty overlay: with no seam there is nothing to lay over the grid.
    expect(container).toBeEmptyDOMElement();
  });
});
