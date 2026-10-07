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

  it("a folded card keeps counting down", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(3000);
    act(() => {
      alerts.info("a4", { id: "a4" });
    });
    // a1 is folded behind "+1 more" now; its clock must not reset or stop.
    expect(titles()).toEqual(["a4", "a3", "a2"]);

    advance(999); // 3999
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(titles()).toEqual(["a4", "a3", "a2", "a1"]);
    // Its bar picks up where the clock is, not from full.
    const a1 = cards().find((c) => titleOf(c) === "a1")!;
    expect(within(a1).getByTestId("alert-countdown").style.animationDelay).toBe("-3999ms");
    advance(1); // 4000
    expect(titles()).toEqual(["a4"]);
    advance(3000); // 7000
    expect(titles()).toEqual([]);
  });

  it("hidden cards expire on time while collapsed", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(2000);
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(titles()).toEqual(["a5", "a4", "a3", "a2", "a1"]);

    advance(1999); // 3999
    expect(titles()).toHaveLength(5);
    advance(1); // 4000
    expect(titles()).toEqual([]);
  });

  it("a collapsed overflow expires without ever being shown", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(4000);
    expect(titles()).toEqual([]);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("expiry does not call onDismiss", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("i", { onDismiss });
    });

    advance(4000);
    expect(titles()).toEqual([]);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("hovering one card pauses only that card", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("a");
      alerts.info("b");
    });

    const a = cards().find((c) => titleOf(c) === "a")!;
    fireEvent.pointerEnter(a);
    advance(4000);
    expect(titles()).toEqual(["a"]);

    fireEvent.pointerLeave(cards()[0]);
    advance(3999);
    expect(titles()).toEqual(["a"]);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("a hovered card that gets folded resumes its countdown", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(1000);
    const a1 = cards().find((c) => titleOf(c) === "a1")!;
    fireEvent.pointerEnter(a1); // a1 holds at 1000 elapsed
    advance(2000); // 3000

    // a1 folds behind "+1 more" while hovered: no pointerleave ever arrives.
    act(() => {
      alerts.info("a4", { id: "a4" });
    });
    expect(titles()).toEqual(["a4", "a3", "a2"]);

    advance(1000); // 4000: a2 and a3 expire, a1 is shown again
    expect(titles()).toEqual(["a4", "a1"]);
    advance(1999); // 5999: a1 has run 3999 of its 4000
    expect(titles()).toEqual(["a4", "a1"]);
    advance(1); // 6000
    expect(titles()).toEqual(["a4"]);
  });

  it("timers are cleared when an entry is removed early and when the host unmounts", () => {
    const { unmount } = render(<AlertHost />);
    act(() => {
      alerts.info("a", { id: "a" });
      alerts.info("b", { id: "b" });
      alerts.warning("standing", { persistent: true });
    });
    // One clock per transient entry; the persistent one has none.
    expect(vi.getTimerCount()).toBe(2);

    act(() => {
      alerts.dismiss("a");
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
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

  it("clicking an actionable card runs its action once and removes it", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("answer", { onClick, onDismiss });
    });
    const card = cards()[0];
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");

    fireEvent.click(within(card).getByTestId("alert-title"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(0);
  });

  it("Enter and Space activate an actionable card", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("enter", { id: "e", onClick, onDismiss });
    });
    let card = cards()[0];
    card.focus();
    expect(card).toHaveFocus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(0);

    act(() => {
      alerts.info("space", { id: "s", onClick, onDismiss });
    });
    card = cards()[0];
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("× on an actionable card dismisses without running the action", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("answer", { onClick, onDismiss });
    });
    const dismiss = within(cards()[0]).getByTestId("alert-dismiss");
    fireEvent.click(dismiss);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    // Enter on a focused × is the ×, not the card.
    act(() => {
      alerts.info("again", { onClick, onDismiss });
    });
    fireEvent.keyDown(within(cards()[0]).getByTestId("alert-dismiss"), { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a card without an action ignores clicks", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("plain", { onDismiss });
    });
    const card = cards()[0];
    expect(card).toHaveAttribute("role", "status");
    expect(card).not.toHaveAttribute("tabindex");

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(cards()).toHaveLength(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
