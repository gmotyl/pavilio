import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AlertHost from "../AlertHost";
import { __resetAlertsForTests, alerts } from "../store";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  __resetAlertsForTests();
  localStorage.clear();
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
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

  it("the region stacks above the modal tier", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("over the quick terminal");
    });

    // Modals (Quick finder, Quick terminal) sit at z-[100]; an alert raised
    // while one is open must still show.
    const z = Number(screen.getByTestId("alert-region").style.zIndex);
    expect(z).toBeGreaterThan(100);
  });

  it("transient cards render above persistent ones", () => {
    render(<AlertHost />);
    act(() => {
      alerts.warning("standing", { persistent: true });
      alerts.info("passing");
    });
    expect(titles()).toEqual(["passing", "standing"]);
  });

  it("every kind expires after the same duration", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("i");
      alerts.error("e");
      alerts.warning("w");
    });

    advance(14_999);
    expect(titles()).toHaveLength(3);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("hover pauses the countdown and leave resumes it", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("i");
    });

    advance(3000);
    fireEvent.pointerEnter(cards()[0]);
    advance(50_000);
    expect(titles()).toEqual(["i"]);

    fireEvent.pointerLeave(cards()[0]);
    advance(11_999);
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

    advance(60_000);
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
    advance(14_999);
    expect(titles()).toEqual(["second"]);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("a folded card keeps counting down", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(13_000);
    act(() => {
      alerts.info("a4", { id: "a4" });
    });
    // a1 is folded behind "+1 more" now; its clock must not reset or stop.
    expect(titles()).toEqual(["a4", "a3", "a2"]);

    advance(1999); // 14999
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(titles()).toEqual(["a4", "a3", "a2", "a1"]);
    // Its bar picks up where the clock is, not from full.
    const a1 = cards().find((c) => titleOf(c) === "a1")!;
    expect(within(a1).getByTestId("alert-countdown").style.animationDelay).toBe("-14999ms");
    advance(1); // 15000
    expect(titles()).toEqual(["a4"]);
    advance(13_000); // 28000
    expect(titles()).toEqual([]);
  });

  it("hidden cards expire on time while collapsed", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(12_000);
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(titles()).toEqual(["a5", "a4", "a3", "a2", "a1"]);

    advance(2999); // 14999
    expect(titles()).toHaveLength(5);
    advance(1); // 15000
    expect(titles()).toEqual([]);
  });

  it("a collapsed overflow expires without ever being shown", () => {
    render(<AlertHost />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) alerts.info(`a${n}`, { id: `a${n}` });
    });

    advance(15_000);
    expect(titles()).toEqual([]);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("expiry does not call onDismiss", () => {
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("i", { onDismiss });
    });

    advance(15_000);
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
    advance(15_000);
    expect(titles()).toEqual(["a"]);

    fireEvent.pointerLeave(cards()[0]);
    advance(14_999);
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

    advance(12_000); // 15000: a2 and a3 expire, a1 is shown again
    expect(titles()).toEqual(["a4", "a1"]);
    advance(1999); // 16999: a1 has run 14999 of its 15000
    expect(titles()).toEqual(["a4", "a1"]);
    advance(1); // 17000
    expect(titles()).toEqual(["a4"]);
  });

  it("timers are cleared when an entry is removed early and when the host unmounts", () => {
    const { unmount } = render(<AlertHost />);
    // The preference store keeps its own timers once mounted; count ours relative to them.
    const base = vi.getTimerCount();
    act(() => {
      alerts.info("a", { id: "a" });
      alerts.info("b", { id: "b" });
      alerts.warning("standing", { persistent: true });
    });
    // One clock per transient entry; the persistent one has none.
    expect(vi.getTimerCount() - base).toBe(2);

    act(() => {
      alerts.dismiss("a");
    });
    expect(vi.getTimerCount() - base).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(base);
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
    // The card stays a live region; its action is a real, focusable button.
    expect(card).toHaveAttribute("role", "status");
    const action = within(card).getByRole("button", { name: "answer" });
    expect(action).toHaveAttribute("type", "button");
    expect(action.tabIndex).toBe(0);

    fireEvent.click(within(card).getByTestId("alert-title"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(0);
  });

  it("Enter and Space activate an actionable card, once each", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<AlertHost />);
    act(() => {
      alerts.info("enter", { id: "e", onClick, onDismiss });
    });
    let action = within(cards()[0]).getByTestId("alert-action");
    action.focus();
    expect(action).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(0);

    act(() => {
      alerts.info("space", { id: "s", onClick, onDismiss });
    });
    action = within(cards()[0]).getByTestId("alert-action");
    action.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(cards()).toHaveLength(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("the dismiss control is not nested inside the action button", () => {
    render(<AlertHost />);
    act(() => {
      alerts.error("failed", { detail: "why", onClick: vi.fn() });
    });
    const card = cards()[0];
    // An error card keeps role alert even when actionable.
    expect(card).toHaveAttribute("role", "alert");
    expect(card).not.toHaveAttribute("tabindex");
    const action = within(card).getByRole("button", { name: /^failed/ });
    const dismiss = within(card).getByRole("button", { name: "Dismiss" });
    expect(action.contains(dismiss)).toBe(false);
    expect(dismiss.contains(action)).toBe(false);
    expect(dismiss.parentElement).toBe(action.parentElement);
    expect(card.closest("[role='button']")).toBeNull();
    expect(within(card).getAllByRole("button")).toHaveLength(2);
  });

  it("× on an actionable card dismisses without running the action", async () => {
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

    // Enter on a focused × is the ×, not the action.
    vi.useRealTimers();
    const user = userEvent.setup();
    act(() => {
      alerts.info("again", { onClick, onDismiss });
    });
    within(cards()[0]).getByTestId("alert-dismiss").focus();
    await user.keyboard("{Enter}");
    expect(cards()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(2);
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
    expect(within(card).queryByTestId("alert-action")).toBeNull();
    expect(within(card).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(cards()).toHaveLength(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("AlertHost display time", () => {
  it("error alert uses the same configured delay as info", () => {
    writePreference(preferences.alertsDurationSeconds, 10);
    render(<AlertHost />);
    act(() => {
      alerts.error("e");
      alerts.info("i");
    });
    advance(9999);
    expect(titles()).toEqual(["i", "e"]);
    advance(1);
    expect(titles()).toEqual([]);
  });

  it("keeps a running alert's bar on the duration its clock captured", () => {
    writePreference(preferences.alertsDurationSeconds, 10);
    render(<AlertHost />);
    act(() => {
      alerts.info("i");
    });
    act(() => {
      writePreference(preferences.alertsDurationSeconds, 3);
    });
    expect(screen.getByTestId("alert-countdown").style.animationDuration).toBe("10000ms");
    advance(9999);
    expect(titles()).toEqual(["i"]);
  });
});

describe("AlertHost detail line", () => {
  afterEach(() => {
    __resetProjectColorsForTests();
  });

  function detailOf(card: HTMLElement): HTMLElement {
    return within(card).getByTestId("alert-detail");
  }

  it("detail line uses secondary ink at 13px", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("saved", { detail: "All changes written" });
    });
    const detail = detailOf(cards()[0]);
    expect(detail.textContent).toBe("All changes written");
    expect(detail.style.color).toBe("var(--text-secondary)");
    expect(detail.style.color).not.toBe("var(--text-muted)");
    expect(detail.style.fontSize).toBe("13px");
    expect(getComputedStyle(detail).fontSize).toBe("13px");
  });

  it("detail line carries no text-xs class", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("saved", { detail: "All changes written" });
    });
    const detail = detailOf(cards()[0]);
    expect(detail).not.toHaveClass("text-xs");
    // Its line-height comes from the card, not from a utility of its own.
    expect([...detail.classList].some((c) => c.startsWith("leading-") || c.startsWith("text-"))).toBe(false);
    expect(detail.style.lineHeight).toBe("");
  });

  it("dismiss control uses tertiary ink and keeps its hover background", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("plain");
    });
    const dismiss = within(cards()[0]).getByTestId("alert-dismiss");
    expect(dismiss.style.color).toBe("var(--text-tertiary)");
    fireEvent.mouseEnter(dismiss);
    expect(dismiss.style.background).toBe("var(--bg-hover)");
    fireEvent.mouseLeave(dismiss);
    expect(dismiss.style.background).toBe("transparent");
  });

  it("project alert keeps its title, project name colour, mark, border and countdown", () => {
    writePreference(preferences.projectColor, "#61afef", "metro");
    render(<AlertHost />);
    act(() => {
      alerts.info("metro · claude 2", { project: "metro", detail: "Answer ready" });
    });
    const card = cards()[0];
    expect(titleOf(card)).toBe("metro · claude 2");
    const name = within(card).getByTestId("alert-project-name");
    expect(name.textContent).toBe("metro");
    expect(name.style.color).toBe("rgb(97, 175, 239)");
    expect(within(card).getByTestId("project-mark").getAttribute("data-color")).toBe("#61afef");
    expect(card.style.borderLeft).toContain("4px");
    expect(card.style.borderLeft).toContain("rgb(97, 175, 239)");
    expect(card.style.background).toContain("color-mix");
    expect(card.style.background).toContain("#61afef");
    const bar = within(card).getByTestId("alert-countdown");
    expect(bar.style.background).toContain("rgb(97, 175, 239)");
    const detail = detailOf(card);
    expect(detail.style.color).toBe("var(--text-secondary)");
    expect(detail.style.fontSize).toBe("13px");
  });

  it("every alert kind renders the same detail style", () => {
    render(<AlertHost />);
    act(() => {
      alerts.error("e", { detail: "d" });
      alerts.warning("w", { detail: "d" });
      alerts.info("i", { detail: "d" });
      alerts.success("s", { detail: "d" });
      alerts.info("metro · claude 2", { project: "metro", detail: "d" });
    });
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(cards()).toHaveLength(5);
    const styles = cards().map((c) => {
      const d = detailOf(c);
      return { className: d.className, color: d.style.color, fontSize: d.style.fontSize };
    });
    for (const s of styles) {
      expect(s).toEqual({
        className: "mt-0.5 block break-words",
        color: "var(--text-secondary)",
        fontSize: "13px",
      });
    }
  });

  it("long detail is not clamped", () => {
    const long = "A long answer preview that keeps going. ".repeat(20).trim();
    render(<AlertHost />);
    act(() => {
      alerts.info("answer", { detail: long });
    });
    const detail = detailOf(cards()[0]);
    expect(detail.textContent).toBe(long);
    expect([...detail.classList].some((c) => c.startsWith("line-clamp") || c === "truncate")).toBe(false);
    const cs = getComputedStyle(detail);
    expect(cs.webkitLineClamp === "" || cs.webkitLineClamp === "none").toBe(true);
    expect(cs.overflowY).toBe("visible");
    expect(cs.overflowX).toBe("visible");
    // It wraps instead of being cut to one line or a fixed height.
    expect(cs.whiteSpace).not.toBe("nowrap");
    expect(cs.textOverflow).not.toBe("ellipsis");
    expect(detail.style.maxHeight).toBe("");
    expect(detail.style.overflow).toBe("");
  });

  it("alert without detail renders no detail line", () => {
    render(<AlertHost />);
    act(() => {
      alerts.info("plain");
      alerts.info("answer", { onClick: vi.fn() });
    });
    for (const c of cards()) expect(within(c).queryByTestId("alert-detail")).toBeNull();
  });
});
