import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import AlertHost from "../AlertHost";
import { __resetAlertsForTests, alerts } from "../store";

/** jsdom has no layout; every card is this wide. */
const CARD_WIDTH = 400;
/** Longer than the slide-out, so a dismissed card is gone after it. */
const PAST_SLIDE_OUT = 1000;

function cards(): HTMLElement[] {
  return screen.queryAllByTestId("alert");
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: CARD_WIDTH,
    height: 48,
    top: 0,
    left: 0,
    right: CARD_WIDTH,
    bottom: 48,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetAlertsForTests();
});

describe("AlertHost swipe", () => {
  it("a swipe past the threshold dismisses and calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true, onDismiss });
    });
    const card = cards()[0];
    expect(card).toHaveStyle({ touchAction: "pan-y" });

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100 });
    advance(400); // slow: only the distance can carry it
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + 0.4 * CARD_WIDTH });
    // The card follows the pointer.
    expect(card.style.transform).toBe(`translateX(${0.4 * CARD_WIDTH}px)`);
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100 + 0.4 * CARD_WIDTH });

    advance(PAST_SLIDE_OUT);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a fast flick dismisses even when short", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true, onDismiss });
    });
    const card = cards()[0];

    // 0.1 × width in 40 ms is 1 px/ms, past 0.6 px/ms.
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100 });
    advance(40);
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 60 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 60 });

    advance(PAST_SLIDE_OUT);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a swipe under reduced motion closes at once", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true, onDismiss });
    });
    const card = cards()[0];

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + 0.5 * CARD_WIDTH });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100 + 0.5 * CARD_WIDTH });

    // No slide-out to wait for.
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("a short slow drag snaps back", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true, onDismiss });
    });
    const card = cards()[0];

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 100 });
    advance(500);
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + 0.1 * CARD_WIDTH });
    expect(card.style.transform).toBe(`translateX(${0.1 * CARD_WIDTH}px)`);
    advance(500);
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100 + 0.1 * CARD_WIDTH });

    advance(PAST_SLIDE_OUT);
    expect(cards()).toEqual([card]);
    expect(card.style.transform).toBe("");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a press on × does not start a drag", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true, onDismiss });
    });
    const card = cards()[0];
    const close = within(card).getByRole("button", { name: "Dismiss" });

    fireEvent.pointerDown(close, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + 0.6 * CARD_WIDTH });
    expect(card.style.transform).toBe("");
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100 + 0.6 * CARD_WIDTH });
    advance(PAST_SLIDE_OUT);
    expect(cards()).toEqual([card]);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(close);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("AlertHost across navigation", () => {
  let navigate: NavigateFunction | null = null;

  function NavigateHandle() {
    navigate = useNavigate();
    return null;
  }

  function renderRouted() {
    render(
      <MemoryRouter initialEntries={["/project/a"]}>
        <NavigateHandle />
        <AlertHost />
        <Routes>
          <Route path="/project/:name" element={<div>project view</div>} />
          <Route path="/settings" element={<div>settings view</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  function go(to: string): void {
    act(() => {
      navigate!(to);
    });
  }

  afterEach(() => {
    navigate = null;
  });

  it("a persistent alert survives a route change once", () => {
    renderRouted();
    act(() => {
      alerts.warning("standing", { persistent: true, id: "ro" });
    });
    expect(screen.getByText("project view")).toBeInTheDocument();

    go("/settings");
    expect(screen.getByText("settings view")).toBeInTheDocument();
    const ro = cards().filter((c) => c.getAttribute("data-alert-id") === "ro");
    expect(ro).toHaveLength(1);
    expect(cards()).toHaveLength(1);
  });

  it("a transient countdown is not reset by navigation", () => {
    renderRouted();
    act(() => {
      alerts.info("passing", { id: "p" });
    });

    advance(2500);
    go("/settings");
    expect(cards().map((c) => c.getAttribute("data-alert-id"))).toEqual(["p"]);
    advance(1499); // 3999
    expect(cards()).toHaveLength(1);
    advance(1); // 4000: the original expiry
    expect(cards()).toHaveLength(0);
  });
});
