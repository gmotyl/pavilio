import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TerminalViewportModal } from "../TerminalViewportModal";
import { STORAGE_KEY } from "../cellReaderTab";
import type { BufferSnapshot } from "../TerminalView";
import type { Utterance } from "../../speech/types";

// mermaid pulls in a browser-only rendering stack; what matters here is that
// the fence reaches the diagram component, not what mermaid draws.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

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

function makeUtterance(text: string, overrides: Partial<Utterance> = {}): Utterance {
  return { id: "u-1", sessionId: "cell-1", text, at: 1_000, ...overrides };
}

type ModalProps = React.ComponentProps<typeof TerminalViewportModal>;

function modalElement(props: Partial<ModalProps> = {}) {
  // MarkdownRenderer calls useNavigate, so the answer source needs a router.
  return (
    <MemoryRouter>
      <TerminalViewportModal
        sessionName="claude-pavilio"
        snapshot={makeSnapshot()}
        answer={null}
        onClose={() => {}}
        {...props}
      />
    </MemoryRouter>
  );
}

function renderModal(props: Partial<ModalProps> = {}) {
  const result = render(modalElement(props));
  return {
    ...result,
    rerender: (next: Partial<ModalProps> = {}) => result.rerender(modalElement(next)),
  };
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
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    rerender({ snapshot: makeSnapshot() });
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

  // --- The Answer source ---

  const answerDoc = ["# Deploy plan", "", "Roll out **gradually** to each store."].join("\n");

  it("renders the answer as formatted markdown, not as terminal text", () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    renderModal({ answer: makeUtterance(answerDoc) });
    const panel = screen.getByTestId("cell-reader-panel-answer");
    expect(screen.getByRole("heading", { level: 1, name: "Deploy plan" })).toBeInTheDocument();
    expect(panel.querySelector("strong")).toHaveTextContent("gradually");
    // The raw markdown markers are not shown as text.
    expect(panel).not.toHaveTextContent("# Deploy plan");
    expect(panel).not.toHaveTextContent("**gradually**");
    // The Screen source's text and its line counter are not showing.
    expect(screen.queryByLabelText("Terminal viewport text")).not.toBeInTheDocument();
    expect(screen.queryByText("4 / 10 lines")).not.toBeInTheDocument();
    expect(screen.getByTestId("viewport-modal-print")).toBeInTheDocument();
  });

  it("draws a mermaid fence in the answer as a diagram", async () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    const fence = ["Flow:", "", "```mermaid", "flowchart TD", "  A --> B", "```", ""].join("\n");
    renderModal({ answer: makeUtterance(fence) });
    await waitFor(() => {
      expect(screen.getByTestId("mermaid").textContent).toBe("flowchart TD\n  A --> B");
    });
    const panel = screen.getByTestId("cell-reader-panel-answer");
    expect(panel.querySelector("pre code")).toBeNull();
  });

  it("says no answer was captured when the cell has none", () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    renderModal({ answer: null });
    const panel = screen.getByTestId("cell-reader-panel-answer");
    expect(panel).toHaveTextContent("No answer was captured for this session.");
    expect(panel.querySelector(".animate-pulse")).toBeNull();
  });

  it("shows the newer response when one arrives while open", () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    const { rerender } = renderModal({ answer: makeUtterance("First response") });
    expect(screen.getByTestId("cell-reader-panel-answer")).toHaveTextContent("First response");
    rerender({ answer: makeUtterance("Second response", { id: "u-2", at: 2_000 }) });
    const panel = screen.getByTestId("cell-reader-panel-answer");
    expect(panel).toHaveTextContent("Second response");
    expect(panel).not.toHaveTextContent("First response");
  });

  it("prints the rendered answer while the answer source is showing", () => {
    localStorage.setItem(STORAGE_KEY, "answer");
    const win = stubPrintWindow();
    renderModal({ answer: makeUtterance(answerDoc) });
    fireEvent.click(screen.getByTestId("viewport-modal-print"));
    expect(window.open).toHaveBeenCalled();
    const body = win.document.body;
    // The rendered HTML went out, not markdown source or buffer text.
    // (textContent, not toHaveTextContent: jest-dom rejects nodes that belong
    // to the detached print document.)
    expect(body.querySelector("strong")?.textContent).toBe("gradually");
    expect(body.textContent).toContain("Deploy plan");
    expect(body.textContent).not.toContain("**gradually**");
    expect(body.textContent).not.toContain("line-6");
    expect(win.focus).toHaveBeenCalled();
  });

  it("prints the buffer text while the screen source is showing", () => {
    const win = stubPrintWindow();
    renderModal({ answer: makeUtterance(answerDoc) });
    expect(screen.getByRole("tab", { name: "Screen" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByTestId("viewport-modal-print"));
    const pre = win.document.body.querySelector("pre");
    expect(pre?.textContent).toContain("line-6");
    expect(pre?.textContent).toContain("line-9");
    expect(pre?.textContent).not.toContain("line-5");
    expect(win.document.body.textContent).not.toContain("Deploy plan");
  });
});
