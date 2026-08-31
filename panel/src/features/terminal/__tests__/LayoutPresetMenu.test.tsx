import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayoutPresetMenu } from "../LayoutPresetMenu";

describe("LayoutPresetMenu", () => {
  it("renders one option per getLayoutPresets(count) entry, even a single one", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={1} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));

    expect(screen.getByTestId("layout-preset-menu")).toBeInTheDocument();
    expect(screen.getByTestId("layout-preset-option-0")).toHaveTextContent("Default");
    expect(screen.queryByTestId("layout-preset-option-1")).not.toBeInTheDocument();
  });

  it("clicking an option calls onApply with that preset's sizes and closes the menu", () => {
    const onApply = vi.fn();
    render(<LayoutPresetMenu count={4} onApply={onApply} />);

    fireEvent.click(screen.getByTestId("layout-preset-toggle"));
    fireEvent.click(screen.getByTestId("layout-preset-option-1"));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([1, 3]);
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
});
