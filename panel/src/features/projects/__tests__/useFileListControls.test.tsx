import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useFileListControls } from "../fileListControls";
import { SORT_STORAGE_KEY } from "../fileListControls";

function Probe() {
  const { debouncedQuery, sortKey, sortDir, controlsBar } = useFileListControls();
  return (
    <div>
      {controlsBar}
      <span data-testid="dq">{debouncedQuery}</span>
      <span data-testid="key">{sortKey}</span>
      <span data-testid="dir">{sortDir}</span>
    </div>
  );
}

describe("useFileListControls", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("defaults to date/desc and debounces the query by 200ms", () => {
    vi.useFakeTimers();
    render(<Probe />);
    expect(screen.getByTestId("key").textContent).toBe("date");
    expect(screen.getByTestId("dir").textContent).toBe("desc");

    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "pro" },
    });
    expect(screen.getByTestId("dq").textContent).toBe(""); // not yet
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("dq").textContent).toBe("pro");
  });

  it("Name button switches sortKey; arrow flips sortDir; both persist", () => {
    render(<Probe />);
    fireEvent.click(screen.getByTestId("file-list-sort-name"));
    fireEvent.click(screen.getByTestId("file-list-sort-dir"));
    expect(screen.getByTestId("key").textContent).toBe("name");
    expect(screen.getByTestId("dir").textContent).toBe("asc");
    expect(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY)!)).toEqual({
      sortKey: "name",
      sortDir: "asc",
    });
  });

  it("restores a persisted sort on mount", () => {
    localStorage.setItem(
      SORT_STORAGE_KEY,
      JSON.stringify({ sortKey: "name", sortDir: "asc" }),
    );
    render(<Probe />);
    expect(screen.getByTestId("key").textContent).toBe("name");
    expect(screen.getByTestId("dir").textContent).toBe("asc");
  });

  it("clear button empties the query", () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.change(screen.getByTestId("file-list-filter-input"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByTestId("file-list-filter-clear"));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("dq").textContent).toBe("");
    expect(
      (screen.getByTestId("file-list-filter-input") as HTMLInputElement).value,
    ).toBe("");
  });
});
