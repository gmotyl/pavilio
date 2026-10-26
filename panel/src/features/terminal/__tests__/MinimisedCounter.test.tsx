import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: ({ sessionId }: { sessionId: string }) => (
    <span data-testid="activity-led" data-session={sessionId} />
  ),
}));

vi.mock("../useTerminalActivityChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useTerminalActivityChannel")>()),
  useAggregateActivityFlags: (ids: readonly string[]) => ({
    hasBusy: false,
    hasAttention: false,
    hasAny: ids.length > 0,
    attentionSinceAt: null,
  }),
}));

import { MinimisedCounter } from "../MinimisedCounter";
import type { SessionMeta } from "../useTerminalSessions";
import { installProjectColors } from "./projectColors.harness";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "m1",
    name: "alpha·1",
    project: "alpha",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const SESSIONS = [
  makeSession({ id: "m1", name: "alpha·1" }),
  makeSession({ id: "m2", name: "beta·1", project: "beta" }),
];

function renderOpen() {
  const onRestore = vi.fn();
  render(
    <>
      <button type="button" data-testid="elsewhere">
        elsewhere
      </button>
      <MinimisedCounter sessions={SESSIONS} onRestore={onRestore} testId="counter" variant="tray" />
    </>,
  );
  const trigger = screen.getByTestId("counter");
  fireEvent.click(trigger);
  expect(screen.getByRole("menu", { name: /minimised terminals/i })).toBeInTheDocument();
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  return { trigger, onRestore };
}

beforeEach(() => {
  installProjectColors();
});

describe("MinimisedCounter — menu", () => {
  it("Escape closes the menu and returns focus to the trigger", () => {
    const { trigger, onRestore } = renderOpen();
    screen.getByTestId("counter-item-m1").focus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("opening moves focus to the first item; arrows move between items and wrap", () => {
    renderOpen();
    const first = screen.getByTestId("counter-item-m1");
    const second = screen.getByTestId("counter-item-m2");
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("a pointerdown outside closes the menu; one inside does not", () => {
    const { onRestore } = renderOpen();

    fireEvent.pointerDown(screen.getByTestId("counter-item-m2"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("a window resize closes the menu", () => {
    renderOpen();

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("MinimisedCounter — menu fits the viewport", () => {
  const originalHeight = window.innerHeight;
  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    vi.restoreAllMocks();
  });

  /** Opens the menu with the trigger pinned at `top`..`top + 20` in a 400px-tall window. */
  function openAt(top: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    const many = Array.from({ length: 30 }, (_, i) => makeSession({ id: `m${i}`, name: `t·${i}` }));
    render(<MinimisedCounter sessions={many} onRestore={vi.fn()} testId="counter" variant="rail" />);
    const trigger = screen.getByTestId("counter");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 300, y: top, width: 40, height: 20 }),
    );
    fireEvent.click(trigger);
    return screen.getByRole("menu");
  }

  // Thirty rows are far taller than any phone; without a bound the list ran off
  // the bottom of the screen with no way to reach the rest.
  it("below the trigger, the menu is capped to the space left and scrolls", () => {
    const menu = openAt(10);
    expect(menu).toHaveClass("overflow-y-auto");
    expect(menu.style.top).toBe("34px");
    // 400 − 34 − an 8px margin.
    expect(menu.style.maxHeight).toBe("358px");
  });

  it("near the bottom of the window, the menu opens above the trigger instead", () => {
    const menu = openAt(360);
    expect(menu.style.top).toBe("");
    // Its bottom edge sits 4px above the trigger's top.
    expect(menu.style.bottom).toBe("44px");
    // 360 − 4 − an 8px margin.
    expect(menu.style.maxHeight).toBe("348px");
  });
});

describe("MinimisedCounter — trigger", () => {
  it.each(["tray", "rail"] as const)(
    "the %s trigger never wraps, so its min-content is its full width",
    (variant) => {
      render(
        <MinimisedCounter sessions={SESSIONS} onRestore={vi.fn()} testId="counter" variant={variant} />,
      );
      // "▁ 2" breaking at its space would let a folded slot shrink below the
      // counter, and the shrink-0 trigger would overlap whatever sits next to it.
      expect(screen.getByTestId("counter")).toHaveClass("whitespace-nowrap");
    },
  );
});
