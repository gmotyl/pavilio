import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayoutPresetMenu } from "../LayoutPresetMenu";
import { GRID, getLayoutPresets } from "../tileLayout";

describe("LayoutPresetMenu", () => {
  it("renders one option per getLayoutPresets(count) entry, even a single one", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={1} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    expect(screen.getByTestId("layout-preset-menu")).toBeInTheDocument();
    expect(screen.getByTestId("layout-preset-option-0")).toBeInTheDocument();
    expect(screen.queryByTestId("layout-preset-option-1")).not.toBeInTheDocument();
  });

  it("names options by shape rather than by ordinal", () => {
    render(<LayoutPresetMenu count={3} onApply={vi.fn()} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    expect(screen.getByLabelText("3 rows")).toBeInTheDocument();
    expect(screen.getByLabelText("3 columns")).toBeInTheDocument();
    expect(screen.queryByText("Alt 1")).not.toBeInTheDocument();
  });

  it("renders a thumbnail per preset built from that preset's own slots", () => {
    render(<LayoutPresetMenu count={3} onApply={vi.fn()} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    const rows = getLayoutPresets(3).find((p) => p.label === "3 rows")!;
    const thumb = screen.getByTestId("layout-preset-thumb-3 rows");
    const boxes = Array.from(thumb.children) as HTMLElement[];

    expect(boxes).toHaveLength(rows.slots.length);
    expect(boxes.map((b) => `${b.style.top}|${b.style.height}`)).toEqual(
      rows.slots.map(
        (slot) => `${(slot.y / GRID) * 100}%|${(slot.h / GRID) * 100}%`,
      ),
    );
  });

  it("clicking an option calls onApply with that preset and closes the menu", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={4} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));
    fireEvent.click(screen.getByTestId("layout-preset-option-1"));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(getLayoutPresets(4)[1]);
    expect(screen.queryByTestId("layout-preset-menu")).not.toBeInTheDocument();
  });

  it("clicking the backdrop closes the menu without calling onApply", () => {
    const onApply = vi.fn();
    const { container } = render(<LayoutPresetMenu count={3} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));
    expect(screen.getByTestId("layout-preset-menu")).toBeInTheDocument();

    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("layout-preset-menu")).not.toBeInTheDocument();
  });

  it("disables the toggle and never opens when count is 0 (no presets)", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={0} onApply={onApply} />);

    const toggle = screen.getByTestId("layout-preset-toggle");
    expect(toggle).toBeDisabled();

    fireEvent.click(toggle);
    expect(screen.queryByTestId("layout-preset-menu")).not.toBeInTheDocument();
  });

  it("a long preset list scrolls inside a bounded panel", () => {
    // 7 sessions is where the generated family gets long — well past what fits
    // under a toolbar without a cap.
    const long = getLayoutPresets(7);
    expect(long.length).toBeGreaterThan(10);

    render(<LayoutPresetMenu count={7} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    const panel = screen.getByTestId("layout-preset-menu");
    // Bounded relative to the viewport, so it cannot run off the bottom of it.
    expect(panel.style.maxHeight).toMatch(/vh$/);
    // ...and the overflow scrolls inside the panel rather than being clipped away.
    expect(panel.style.overflowY).toBe("auto");
  });

  it("a short preset list is not padded to the cap", () => {
    render(<LayoutPresetMenu count={1} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    const panel = screen.getByTestId("layout-preset-menu");
    // The bound is a cap, not a size: nothing fixes or floors the panel's height,
    // so one option leaves no empty scroll area below it.
    expect(panel.style.maxHeight).toMatch(/vh$/);
    expect(panel.style.height).toBe("");
    expect(panel.style.minHeight).toBe("");
  });

  it("every preset stays reachable and keeps its accessible name", () => {
    const presets = getLayoutPresets(7);
    render(<LayoutPresetMenu count={7} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    presets.forEach((preset, i) => {
      const option = screen.getByTestId(`layout-preset-option-${i}`);
      expect(option).toHaveAttribute("aria-label", preset.label);
      // The thumbnail is still drawn from that preset's own rects.
      const thumb = screen.getByTestId(`layout-preset-thumb-${preset.label}`);
      expect(Array.from(thumb.children)).toHaveLength(preset.slots.length);
    });

    expect(
      screen.queryByTestId(`layout-preset-option-${presets.length}`),
    ).not.toBeInTheDocument();
  });

  it("pressing Escape closes the menu", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={3} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));
    expect(screen.getByTestId("layout-preset-menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("layout-preset-menu")).not.toBeInTheDocument();
  });
});
