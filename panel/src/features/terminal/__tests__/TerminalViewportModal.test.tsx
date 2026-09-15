import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalViewportModal } from "../TerminalViewportModal";
import { STORAGE_KEY } from "../cellReaderTab";
import type { BufferSnapshot } from "../TerminalView";

/**
 * Ten lines of scrollback, three rows per page, viewport on the last four
 * lines (6..9). Paging back once shows 3..9, twice shows 0..9.
 */
function makeSnapshot(overrides: Partial<BufferSnapshot> = {}): BufferSnapshot {
  const lines = Array.from({ length: 10 }, (_, i) => [{ text: `line-${i}` }]);
  return {
    lines,
    viewportTopIndex: 6,
    viewportBottomIndex: 9,
    pageSize: 3,
    pixelWidth: 800,
    fontSize: 13,
    defaultFg: "#ffffff",
    defaultBg: "#000000",
    ...overrides,
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof TerminalViewportModal>> = {}) {
  return render(
    <TerminalViewportModal
      sessionName="claude-pavilio"
      snapshot={makeSnapshot()}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("TerminalViewportModal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Characterization: the Screen source behaves as it did before tabs ---

  it("shows the terminal buffer text when opened with no stored source", () => {
    renderModal();
    const text = screen.getByLabelText("Terminal viewport text");
    expect(text).toHaveTextContent("line-6");
    expect(text).toHaveTextContent("line-9");
    expect(text).not.toHaveTextContent("line-5");
    expect(screen.getByTestId("viewport-modal-print")).toBeInTheDocument();
    expect(screen.getByText("4 / 10 lines")).toBeInTheDocument();
  });

  it("pages further back through scrollback from the chevron", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("viewport-modal-load-previous"));
    const text = screen.getByLabelText("Terminal viewport text");
    expect(text).toHaveTextContent("line-3");
    expect(text).toHaveTextContent("line-9");
    expect(text).not.toHaveTextContent("line-2");
    expect(screen.getByText("7 / 10 lines")).toBeInTheDocument();
  });

  it("hides the page-back control once there is nothing further back", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("viewport-modal-load-previous"));
    fireEvent.click(screen.getByTestId("viewport-modal-load-previous"));
    expect(screen.getByLabelText("Terminal viewport text")).toHaveTextContent("line-0");
    expect(screen.queryByTestId("viewport-modal-load-previous")).not.toBeInTheDocument();
  });

  // --- The tab strip ---

  it("opens on the screen source when nothing has been chosen", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Terminal viewport text")).toHaveTextContent("line-6");
  });

  it("marks the showing source in the tab strip", () => {
    renderModal();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Answer" }));
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByLabelText("Terminal viewport text")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Screen" }));
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Terminal viewport text")).toHaveTextContent("line-6");
  });

  it("persists the source when the user switches to the answer tab", () => {
    // Spy on the instance: in this jsdom build localStorage is a plain object
    // whose prototype is not Storage.prototype, so a prototype spy never fires.
    const setItem = vi.spyOn(localStorage, "setItem");
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Answer" }));
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, "answer");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("answer");
  });

  it("reopens on the source chosen last time", () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    // A different cell than the one the choice was made in.
    renderModal({ sessionName: "codex-other-project" });
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "false");
  });

  it("reopens on the source chosen last time for another cell", () => {
    // TerminalLayoutGrid keeps one modal mounted per cell, closed with a null
    // snapshot. A choice made in another cell must be picked up on open.
    const { rerender } = renderModal({ snapshot: null });
    localStorage.setItem(STORAGE_KEY, "answer");
    rerender(
      <TerminalViewportModal
        sessionName="claude-pavilio"
        snapshot={makeSnapshot()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "false");
  });

  it("opens on the screen source when storage is unavailable", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    renderModal();
    // The spy must actually be reached, otherwise this test proves nothing.
    expect(getItem).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Terminal viewport text")).toHaveTextContent("line-6");
    // Switching still works even though the choice cannot be remembered.
    expect(() => fireEvent.click(screen.getByRole("tab", { name: "Answer" }))).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "true");
  });
});
