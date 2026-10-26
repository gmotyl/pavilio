import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { compile } from "tailwindcss";
import { TerminalShortcutBar } from "../TerminalShortcutBar";

describe("TerminalShortcutBar", () => {
  test("renders the new button set in order: Esc, arrows, Tab, ⇧Tab, Ctrl+C, ⏎", () => {
    render(<TerminalShortcutBar onSend={() => {}} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    // Filter out the optional keyboard toggle (last)
    const shortcuts = labels.filter((l) =>
      ["Esc", "↑", "↓", "←", "→", "Tab", "⇧Tab", "Ctrl+C", "⏎"].includes(l ?? "")
    );
    expect(shortcuts).toEqual([
      "Esc", "↑", "↓", "←", "→", "Tab", "⇧Tab", "Ctrl+C", "⏎",
    ]);
  });

  test("⏎ sends \\r", () => {
    const onSend = vi.fn();
    render(<TerminalShortcutBar onSend={onSend} />);
    fireEvent.pointerDown(screen.getByText("⏎"));
    expect(onSend).toHaveBeenCalledWith("\r");
  });

  test("↑ sends ESC[A", () => {
    const onSend = vi.fn();
    render(<TerminalShortcutBar onSend={onSend} />);
    fireEvent.pointerDown(screen.getByText("↑"));
    expect(onSend).toHaveBeenCalledWith("\x1b[A");
  });

  test("shortcut bar keeps its buttons on one scrollable line", () => {
    render(<TerminalShortcutBar onSend={() => {}} onToggleKeyboard={() => {}} />);
    const bar = screen.getByTestId("terminal-shortcut-esc").parentElement!;
    const classes = bar.className.split(/\s+/);

    // `flex-wrap` grew the bar a line at a time on a phone; one line that
    // scrolls sideways keeps the terminal above it the same height.
    expect(classes).toContain("flex-nowrap");
    expect(classes).not.toContain("flex-wrap");
    expect(classes).toContain("overflow-x-auto");
    // Without this a non-wrapping row squashes its buttons instead of scrolling.
    for (const button of screen.getAllByRole("button")) {
      expect(button.className.split(/\s+/), button.textContent ?? "").toContain("shrink-0");
    }
  });

  /**
   * jsdom lays nothing out, so the row count is worked out from what the cascade
   * gives the bar: its Tailwind classes are compiled for real and injected, and
   * the flex-line rule (a `nowrap` container is one line; a wrapping one breaks
   * wherever the next button no longer fits) is applied to the computed styles.
   * Button widths are stubbed wide enough that ten of them cannot fit at 360px,
   * which is the premise the bar has to survive.
   */
  test("shortcut bar stays one row tall at 360px", async () => {
    const VIEWPORT = 360;
    const BUTTON_WIDTH = 48;
    const BUTTON_HEIGHT = 26;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: VIEWPORT });
    window.dispatchEvent(new Event("resize"));

    render(<TerminalShortcutBar onSend={() => {}} onToggleKeyboard={() => {}} />);
    const bar = screen.getByTestId("terminal-shortcut-esc").parentElement!;
    const buttons = screen.getAllByRole("button");

    const candidates = [bar, ...buttons].flatMap((el) => el.className.split(/\s+/));
    const compiler = await compile("@tailwind utilities;", { base: "/" });
    const style = document.createElement("style");
    style.textContent = compiler.build(candidates);
    document.head.append(style);

    try {
      // The premise: the buttons are wider than the viewport.
      expect(buttons.length * BUTTON_WIDTH).toBeGreaterThan(VIEWPORT);

      const barStyle = getComputedStyle(bar);
      let rows = 1;
      if (barStyle.flexWrap !== "nowrap") {
        let used = 0;
        for (const _ of buttons) {
          if (used > 0 && used + BUTTON_WIDTH > VIEWPORT) {
            rows += 1;
            used = 0;
          }
          used += BUTTON_WIDTH;
        }
      }

      expect(rows * BUTTON_HEIGHT, `${rows} rows of buttons`).toBe(BUTTON_HEIGHT);
      // The overflow scrolls rather than squashing the buttons or spilling out.
      expect(barStyle.overflowX).toBe("auto");
      for (const button of buttons) {
        expect(getComputedStyle(button).flexShrink, button.textContent ?? "").toBe("0");
      }
    } finally {
      style.remove();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
