import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  test("does NOT render removed buttons (yes, 1, 2, 3)", () => {
    render(<TerminalShortcutBar onSend={() => {}} />);
    expect(screen.queryByText("yes")).toBeNull();
    expect(screen.queryByText("1")).toBeNull();
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
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
});
