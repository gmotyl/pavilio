import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { num } from "../../../preferences/codecs";
import { definePreference } from "../../../preferences/types";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { useResizableRow, type RowBounds } from "../useResizableRow";

/**
 * Every write that reached the store, so the settled height can be read as the
 * store would read it back. The factory is hoisted above the imports, so the
 * array it closes over has to be hoisted with it.
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

const HEIGHT_KEY = "test.row.height";

const rowHeight = definePreference({
  key: HEIGHT_KEY,
  scope: "global",
  default: 140,
  codec: num,
  portable: true,
});

const BOUNDS: RowBounds = { min: 96, max: 320, step: 24 };

/**
 * A row the way the composer will consume the hook: the rail sits on its TOP
 * edge, and the height is applied only off mobile — on a phone the row is laid
 * out by the viewport, not by a stored pixel count.
 */
function Probe() {
  const { height, isMobile, dragging, handleProps } = useResizableRow(rowHeight, BOUNDS);
  const { isMobile: hideOnMobile, ...rail } = handleProps;
  return (
    <div>
      <section data-testid="row" style={isMobile ? undefined : { height: `${height}px` }}>
        <span data-testid="height">{height}</span>
      </section>
      <span data-testid="dragging">{String(dragging)}</span>
      <span data-testid="mobile">{String(isMobile)}</span>
      <span data-testid="handle-mobile">{String(hideOnMobile)}</span>
      <div data-testid="handle" data-edge="top" {...rail} />
    </div>
  );
}

const height = () => screen.getByTestId("height").textContent;
const doc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;
const seed = (value: number) => {
  doc()[HEIGHT_KEY] = value;
};
const rowWrites = () => writes.filter((w) => w.key === HEIGHT_KEY);

describe("useResizableRow", () => {
  beforeEach(() => {
    writes.length = 0;
    seed(140);
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    installMatchMedia(false);
  });

  it("grows the row when a top-edge drag moves the pointer up", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");
    expect(height()).toBe("140");

    // Up the screen is a FALLING clientY, and a rail on the top edge grows the
    // row downward from there — the inverse of the width axis, which is the
    // whole reason this hook is not `useResizablePane`.
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 460 });
    expect(height()).toBe("180");
    expect(screen.getByTestId("row")).toHaveStyle({ height: "180px" });
    expect(screen.getByTestId("dragging").textContent).toBe("true");

    // ...and dragging back down shrinks it, which a sign-agnostic
    // implementation would still get right by accident.
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 520 });
    expect(height()).toBe("120");

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 520 });
    expect(height()).toBe("120");
    expect(screen.getByTestId("dragging").textContent).toBe("false");
  });

  it("clamps the dragged height to the declared bounds", () => {
    const tall = render(<Probe />);
    let handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 });
    expect(height()).toBe("320");
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });
    expect(height()).toBe("320");
    tall.unmount();

    seed(140);
    render(<Probe />);
    handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 900 });
    expect(height()).toBe("96");
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 900 });
    expect(height()).toBe("96");
  });

  it("persists the settled height to the preference, as a whole number", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 480 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 459.4 });
    // Nothing is written while the pointer is down: the store broadcasts every
    // write to every hook on the key, and re-rendering all of them per
    // pointermove is what makes a drag stutter.
    expect(rowWrites()).toEqual([]);

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 459.4 });
    // 140 + 40.6 of pointer travel — a fraction is pointer noise, and it would
    // otherwise be persisted verbatim.
    expect(rowWrites()).toEqual([{ key: HEIGHT_KEY, value: 181 }]);
  });

  it("steps the height with the arrow keys", () => {
    render(<Probe />);
    const handle = screen.getByTestId("handle");
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(height()).toBe("164");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(height()).toBe("140");

    // A key the rail has no meaning for is left to the page.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(height()).toBe("140");
  });

  it("reports isMobile and leaves the height unapplied on a narrow viewport", () => {
    const media = installMatchMedia(true);
    render(<Probe />);

    expect(screen.getByTestId("mobile").textContent).toBe("true");
    // The rail is hidden the same way `PaneResizer` hides the vertical one.
    expect(screen.getByTestId("handle-mobile").textContent).toBe("true");
    // The row is laid out by the viewport on a phone, so the consumer spends
    // the verdict by not applying the stored height at all.
    expect(screen.getByTestId("row")).not.toHaveStyle({ height: "140px" });

    media.setMobile(false);
    expect(screen.getByTestId("mobile").textContent).toBe("false");
    expect(screen.getByTestId("row")).toHaveStyle({ height: "140px" });
  });
});

/** A `project`-scoped row, for the scope argument itself rather than the drag. */
const SCOPED_KEY = "test.row.scopedHeight";

const scopedRowHeight = definePreference({
  key: SCOPED_KEY,
  scope: "project",
  default: 140,
  codec: num,
  portable: true,
});

function ScopedProbe({ scope }: { scope: string | null }) {
  const { height, isMobile, handleProps } = useResizableRow(scopedRowHeight, BOUNDS, scope);
  const { isMobile: hideOnMobile, ...rail } = handleProps;
  return (
    <div>
      <span data-testid="height">{height}</span>
      <span data-testid="mobile">{String(isMobile)}</span>
      <span data-testid="handle-mobile">{String(hideOnMobile)}</span>
      <div data-testid="handle" data-edge="top" {...rail} />
    </div>
  );
}

const scopedKeys = () => Object.keys(doc()).filter((k) => k.startsWith(SCOPED_KEY));
const scopedWrites = () => writes.filter((w) => w.key === SCOPED_KEY);

/**
 * The hook's third answer to "which scope": none.
 *
 * A row whose scope is DISCOVERED — a project looked up from a session id, say
 * — can be asked for a height before the lookup can answer. The hook is in
 * `features/shell` and has no business knowing what any one caller failed to
 * find, so "I looked and there is nothing" is spelt `null` and nothing else.
 *
 * What it must not do with that is invent a key. A stand-in name is a key, and
 * a key is written to: the number would land where nothing reads it back once
 * the real scope arrives, so the drag would be silently discarded — and every
 * unresolved row in the tab would share the one value until then.
 */
describe("useResizableRow with an unresolved scope", () => {
  beforeEach(() => {
    writes.length = 0;
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    installMatchMedia(false);
  });

  it("drags from the declared default and stores nothing", () => {
    // A height stored for a real project, to make the point that the
    // unresolved row neither reads it nor writes over it.
    doc()[`${SCOPED_KEY}@alpha`] = 200;

    render(<ScopedProbe scope={null} />);
    // The DECLARED default, not the named project's height and not a throw.
    expect(height()).toBe("140");

    const handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 460 });
    // The drag works: an unresolved scope is a reason not to store a number,
    // not a reason to refuse one.
    expect(height()).toBe("180");

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 460 });
    // And it holds for as long as the scope stays unresolved — NOT for the
    // life of the hook, which is what this comment used to claim: the test
    // below is the transition it does not survive.
    expect(height()).toBe("180");

    // Nothing written, under any key — not a placeholder, and not the real
    // project's, which still holds what it held.
    expect(scopedWrites()).toEqual([]);
    expect(scopedKeys()).toEqual([`${SCOPED_KEY}@alpha`]);
    expect(doc()[`${SCOPED_KEY}@alpha`]).toBe(200);
  });

  it("keeps the arrow keys working without storing them either", () => {
    render(<ScopedProbe scope={null} />);
    const handle = screen.getByTestId("handle");
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(height()).toBe("164");

    expect(scopedWrites()).toEqual([]);
    expect(scopedKeys()).toEqual([]);
  });

  it("stores under the scope as soon as there is one", () => {
    render(<ScopedProbe scope="alpha" />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 460 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 460 });

    expect(scopedWrites()).toEqual([{ key: SCOPED_KEY, value: 180 }]);
    expect(doc()[`${SCOPED_KEY}@alpha`]).toBe(180);
  });

  it("adopts the scope's stored height when the lookup answers later", () => {
    doc()[`${SCOPED_KEY}@alpha`] = 200;
    const { rerender } = render(<ScopedProbe scope={null} />);
    expect(height()).toBe("140");

    rerender(<ScopedProbe scope="alpha" />);
    // Self-healing: the row that mounted before its project was known is a
    // reader of that project's height the moment the project arrives.
    expect(height()).toBe("200");
  });

  /**
   * What happens to a drag the user made BEFORE the scope arrived.
   *
   * Nothing pinned this until now, and the hook's own note claimed the wrong
   * thing about it — that an unresolved scope keeps what the user does "for
   * the life of the hook". It does not, and it should not: the dragged number
   * was never stored, so surviving the transition would leave the control
   * showing a height this project does not have and will not have after a
   * reload. The stored value wins, and the drag is not written into the scope
   * on its way out either — the user chose it before anyone knew which project
   * they were choosing it for.
   */
  it("drops a drag made while the scope was unresolved once it resolves", () => {
    // The project's height, and nowhere near the one the drag below settles
    // on, so the assertion afterwards can only be read one way.
    doc()[`${SCOPED_KEY}@alpha`] = 272;
    const { rerender } = render(<ScopedProbe scope={null} />);

    const handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 440 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 440 });
    // The drag worked, as the case above pins.
    expect(height()).toBe("200");

    rerender(<ScopedProbe scope="alpha" />);

    // The project's own height, not the one under the hand a moment ago.
    expect(height()).toBe("272");
    // And the drag was not persisted on the way past: the project still holds
    // what it held, and no write was made under any key.
    expect(doc()[`${SCOPED_KEY}@alpha`]).toBe(272);
    expect(scopedWrites()).toEqual([]);
  });
});
