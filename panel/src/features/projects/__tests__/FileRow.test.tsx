import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("marks the current entry", () => {
    render(
      <FileRow
        testId="row"
        label="a.md"
        isCurrent
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("row-current-badge")).toBeTruthy();
  });

  it("omits the badge when not current", () => {
    render(<FileRow testId="row" label="a.md" onSelect={() => {}} />);
    expect(screen.queryByTestId("row-current-badge")).toBeNull();
  });

  it("renders the star slot when given", () => {
    render(
      <FileRow
        testId="row"
        label="a.md"
        star={<button data-testid="row-star">star</button>}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("row-star")).toBeTruthy();
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
