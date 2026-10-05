import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import AlertHost from "../AlertHost";
import { __resetAlertsForTests, alerts } from "../store";

function cards(): HTMLElement[] {
  return screen.queryAllByTestId("alert");
}

function titleOf(card: HTMLElement): string {
  return within(card).getByTestId("alert-title").textContent ?? "";
}

function titles(): string[] {
  return cards().map(titleOf);
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetAlertsForTests();
});

describe("AlertHost", () => {
  it("caps the visible stack at three with a +N more control that expands", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    expect(titles()).toEqual(["a5", "a4", "a3"]);
    const more = screen.getByRole("button", { name: "+2 more" });

    fireEvent.click(more);
    expect(titles()).toEqual(["a5", "a4", "a3", "a2", "a1"]);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();

    act(() => {
      alerts.dismiss("a5");
      alerts.dismiss("a4");
    });
    expect(titles()).toEqual(["a3", "a2", "a1"]);

    // Collapsed back: a fourth push folds into the pill again.
    act(() => {
      alerts.info("a6", { id: "a6" });
    });
    expect(titles()).toEqual(["a6", "a3", "a2"]);
    expect(screen.getByRole("button", { name: "+1 more" })).toBeInTheDocument();
  });

  it("transient cards render above persistent ones", () => {
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true });
      alerts.info("passing");
    });
    expect(titles()).toEqual(["passing", "standing"]);
  });

  it("each kind expires after its own duration", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("i");
      alerts.error("e");
    });

    advance(3999);
    expect(titles()).toEqual(["e", "i"]);
    advance(1);
    expect(titles()).toEqual(["e"]);

    advance(2000); // 6000
    expect(titles()).toEqual(["e"]);
    advance(2000); // 8000
    expect(titles()).toEqual([]);
  });

  it("hover pauses the countdown and leave resumes it", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("i");
    });

    advance(3000);
    fireEvent.pointerEnter(cards()[0]);
    advance(5000);
    expect(titles()).toEqual(["i"]);

    fireEvent.pointerLeave(cards()[0]);
    advance(999);
    expect(titles()).toEqual(["i"]);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("persistent alerts have no timer and stay", () => {
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true });
      alerts.info("passing");
    });

    advance(10_000);
    expect(titles()).toEqual(["standing"]);
    expect(within(cards()[0]).queryByTestId("alert-countdown")).toBeNull();
  });

  it("× removes only that card and calls onDismiss", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("a", { onDismiss: onA });
      alerts.info("b", { onDismiss: onB });
    });

    const b = cards().find((c) => titleOf(c) === "b")!;
    fireEvent.click(within(b).getByRole("button", { name: "Dismiss" }));

    expect(titles()).toEqual(["a"]);
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onA).not.toHaveBeenCalled();
  });

  it("a refreshed id restarts its timer", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("first", { id: "x" });
    });

    advance(3000);
    act(() => {
      alerts.info("second", { id: "x" });
    });
    advance(3999);
    expect(titles()).toEqual(["second"]);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("error uses role alert, others role status", () => {
    render(<AlertHost />);
    act(() => {
      alerts.error("e");
      alerts.warning("w");
      alerts.info("i");
      alerts.success("s");
    });
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));

    const byKind = Object.fromEntries(cards().map((c) => [c.getAttribute("data-kind"), c]));
    expect(byKind.error).toHaveAttribute("role", "alert");
    expect(byKind.warning).toHaveAttribute("role", "status");
    expect(byKind.info).toHaveAttribute("role", "status");
    expect(byKind.success).toHaveAttribute("role", "status");
    for (const c of cards()) {
      expect(within(c).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
      // The region lets clicks through its gaps; only the cards catch them.
      expect(c).toHaveStyle({ pointerEvents: "auto" });
    }
    expect(screen.getByTestId("alert-region")).toHaveStyle({ position: "fixed", pointerEvents: "none" });
  });
});
