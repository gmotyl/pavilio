import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { num } from "../../../preferences/codecs";
import { definePreference } from "../../../preferences/types";
import { useResizablePane, MOBILE_QUERY, type PaneBounds } from "../useResizablePane";

/**
 * Every write that reached the store, so "once per drag" can be counted rather
 * than inferred. The factory is hoisted above the imports, so the array it
 * closes over has to be hoisted with it.
 */
const { writes } = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    writePreference: <T,>(
      def: Parameters<typeof actual.writePreference<T>>[0],
      value: T,
      scopeArg?: string,
    ) => {
      writes.push({ key: def.key, value });
      actual.writePreference(def, value, scopeArg);
    },
  };
});

/** Controllable matchMedia stub — jsdom has none. */
function installMatchMedia(mobile: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = mobile;
  const mql = {
    get matches() {
      return matches;
    },
    media: MOBILE_QUERY,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMobile(next: boolean) {
      matches = next;
      act(() => {
        listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
      });
    },
  };
}

const WIDTH_KEY = "test.pane.width";

const paneWidth = definePreference({
  key: WIDTH_KEY,
  scope: "global",
  default: 320,
  codec: num,
  portable: true,
});

const BOUNDS: PaneBounds = { min: 200, max: 600, step: 16 };

function Probe({ edge = "right" }: { edge?: "left" | "right" }) {
  const { width, isMobile, handleProps } = useResizablePane(paneWidth, BOUNDS);
  const { isMobile: hideOnMobile, ...rail } = handleProps;
  return (
    <div>
      <span data-testid="width">{width}</span>
      <span data-testid="mobile">{String(isMobile)}</span>
      <span data-testid="handle-mobile">{String(hideOnMobile)}</span>
      <div data-testid="handle" data-edge={edge} {...rail} />
    </div>
  );
}

const width = () => screen.getByTestId("width").textContent;
const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;
const seed = (value: number) => {
  doc()[WIDTH_KEY] = value;
};
const paneWrites = () => writes.filter((w) => w.key === WIDTH_KEY);

describe("useResizablePane", () => {
  beforeEach(() => {
    writes.length = 0;
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    installMatchMedia(false);
  });

  it("the width tracks the pointer during a drag", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");
    expect(width()).toBe("320");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 540 });
    expect(width()).toBe("360");

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520 });
    expect(width()).toBe("340");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 520 });
    expect(width()).toBe("340");
  });

  it("the width stops at the minimum bound", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    expect(width()).toBe("200");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });
    expect(width()).toBe("200");
  });

  it("the width stops at the maximum bound", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    expect(width()).toBe("600");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900 });
    expect(width()).toBe("600");
  });

  it("a stored width outside the bounds is clamped", () => {
    seed(999);
    const tooWide = render(<Probe />);
    expect(width()).toBe("600");
    tooWide.unmount();

    seed(40);
    render(<Probe />);
    expect(width()).toBe("200");
  });

  it("arrow keys move the width by one step", () => {
    const right = render(<Probe />);
    const handle = screen.getByTestId("handle");
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe("336");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe("320");
    right.unmount();

    // A rail on the pane's left edge grows it the other way round.
    render(<Probe edge="left" />);
    fireEvent.keyDown(screen.getByTestId("handle"), { key: "ArrowLeft" });
    expect(width()).toBe("336");
  });

  it("the width is written once per drag, not per pointer-move", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 580 });
    expect(paneWrites()).toHaveLength(0);

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 580 });
    expect(paneWrites()).toEqual([{ key: WIDTH_KEY, value: 400 }]);
    expect(width()).toBe("400");
  });

  it("a lost pointer capture ends the drag", () => {
    const dropped = render(<Probe />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 540 });
    expect(width()).toBe("360");

    fireEvent.lostPointerCapture(handle, { pointerId: 1 });
    // a button-less move over the rail must no longer resize anything
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 580 });
    expect(width()).toBe("360");
    // and the width the drag reached was still written, exactly once
    expect(paneWrites()).toEqual([{ key: WIDTH_KEY, value: 360 }]);
    dropped.unmount();

    writes.length = 0;
    seed(320);
    render(<Probe />);
    const cancelled = screen.getByTestId("handle");
    fireEvent.pointerDown(cancelled, { pointerId: 2, clientX: 500 });
    fireEvent.pointerMove(cancelled, { pointerId: 2, clientX: 530 });
    expect(width()).toBe("350");

    fireEvent.pointerCancel(cancelled, { pointerId: 2, clientX: 530 });
    fireEvent.pointerMove(cancelled, { pointerId: 2, clientX: 600 });
    expect(width()).toBe("350");
    expect(paneWrites()).toEqual([{ key: WIDTH_KEY, value: 350 }]);
  });

  it("reports the mobile viewport and follows the media query", () => {
    const media = installMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("mobile").textContent).toBe("true");
    expect(screen.getByTestId("handle-mobile").textContent).toBe("true");

    media.setMobile(false);
    expect(screen.getByTestId("mobile").textContent).toBe("false");
  });
});
