import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalViewportModal } from "../TerminalViewportModal";
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

type ModalProps = React.ComponentProps<typeof TerminalViewportModal>;

function renderModal(props: Partial<ModalProps> = {}) {
  return render(
    <TerminalViewportModal
      sessionName="claude-pavilio"
      snapshot={makeSnapshot()}
      onClose={() => {}}
      {...props}
    />,
  );
}

/**
 * Stands in for the window `handlePrint` opens: a detached document the
 * component writes into, so a test can inspect what would have been printed.
 */
function stubPrintWindow() {
  const doc = document.implementation.createHTMLDocument("print");
  const win = { document: doc, focus: vi.fn(), print: vi.fn() };
  vi.stubGlobal("open", vi.fn(() => win));
  return win;
}

describe("TerminalViewportModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the terminal buffer text when opened", () => {
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

  it("prints the buffer text", () => {
    const win = stubPrintWindow();
    renderModal();
    fireEvent.click(screen.getByTestId("viewport-modal-print"));
    expect(window.open).toHaveBeenCalled();
    const pre = win.document.body.querySelector("pre");
    expect(pre?.textContent).toContain("line-6");
    expect(pre?.textContent).toContain("line-9");
    expect(pre?.textContent).not.toContain("line-5");
    expect(win.focus).toHaveBeenCalled();
  });

  // --- Screen is the reader's only source; the answer lives in the pane under
  // the speech bar now, so nothing here switches sources or remembers one. ---

  it("the reader shows one source and no tab strip", () => {
    renderModal();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cell-reader-panel-answer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Terminal viewport text")).toHaveTextContent("line-6");
  });

  it("the reader touches no storage", () => {
    // Spy on the instance: in this jsdom build localStorage is a plain object
    // whose prototype is not Storage.prototype, so a prototype spy never fires.
    const getItem = vi.spyOn(window.localStorage, "getItem");
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const removeItem = vi.spyOn(window.localStorage, "removeItem");
    const { rerender } = renderModal({ snapshot: null });
    // Opening (a null -> snapshot transition, as TerminalLayoutGrid does it),
    // paging back and printing are every interaction the reader has.
    rerender(
      <TerminalViewportModal sessionName="claude-pavilio" snapshot={makeSnapshot()} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("viewport-modal-load-previous"));
    stubPrintWindow();
    fireEvent.click(screen.getByTestId("viewport-modal-print"));
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
