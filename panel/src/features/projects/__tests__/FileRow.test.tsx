import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import FileRow from "../FileRow";

describe("FileRow", () => {
  it("renders the label and calls onSelect", () => {
    const onSelect = vi.fn();
    render(
      <FileRow testId="plans-tab-file-project-a.md" label="a.md" onSelect={onSelect} />,
    );
    const row = screen.getByTestId("plans-tab-file-project-a.md");
    expect(row.textContent).toContain("a.md");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders an optional date label", () => {
    render(
      <FileRow
        testId="section-files-file-p/notes/x.md"
        label="x.md"
        dateLabel="Jul 14"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Jul 14")).toBeTruthy();
  });

  it("spreads drag props onto the row button", () => {
    render(
      <FileRow
        testId="row"
        label="a.md"
        dragProps={{ draggable: true }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("row").getAttribute("draggable")).toBe("true");
  });
});

describe("FileRow delete control", () => {
  const mountWithDelete = (run = vi.fn(async () => {})) => {
    const onSelect = vi.fn();
    render(
      <FileRow
        testId="row"
        label="pavilio-pr-237"
        kind="story"
        deleteControl={{ name: "stories/pavilio-pr-237.md", confirmLabel: "Delete?", run }}
        onSelect={onSelect}
      />,
    );
    return { run, onSelect };
  };

  it("delete icon shows on hover and focus only", () => {
    mountWithDelete();
    const del = screen.getByRole("button", { name: "Delete stories/pavilio-pr-237.md" });
    expect(del.getAttribute("data-testid")).toBe("row-delete");
    expect(del.textContent).toBe("");
    expect(del.querySelector("svg")).toBeTruthy();
    // Hidden at rest; the row's hover or any focus inside the row reveals it.
    expect(del.className).toContain("opacity-0");
    expect(del.className).toContain("group-hover:opacity-100");
    expect(del.className).toContain("group-focus-within:opacity-100");
    expect(del.parentElement?.className).toContain("group");
    // The row's story badge has its own colour.
    expect(screen.getByTestId("row-kind").style.color).toBe("var(--blue)");
  });

  it("armed delete times out and on blur", () => {
    vi.useFakeTimers();
    try {
      const { run, onSelect } = mountWithDelete();
      const del = screen.getByTestId("row-delete");
      fireEvent.click(del);
      expect(del.textContent).toBe("Delete?");
      expect(del.getAttribute("aria-label")).toBe("Confirm delete stories/pavilio-pr-237.md");
      expect(del.className).toContain("opacity-100");
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      expect(del.textContent).toBe("");
      fireEvent.click(del);
      expect(del.textContent).toBe("Delete?");
      fireEvent.blur(del);
      expect(del.textContent).toBe("");
      expect(run).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
