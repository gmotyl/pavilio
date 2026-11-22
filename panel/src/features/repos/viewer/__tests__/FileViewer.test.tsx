import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../../../../test-utils";
import { preferences } from "../../../../preferences/declarations";
import { readPreference } from "../../../../preferences/store";
import FileViewer from "../FileViewer";

/** A ResizeObserver the test drives: `resize(width)` reports a new content width to every observer. */
class DrivenResizeObserver {
  static all: DrivenResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) {
    DrivenResizeObserver.all.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    DrivenResizeObserver.all = DrivenResizeObserver.all.filter((o) => o !== this);
  }
  static resize(width: number): void {
    for (const o of DrivenResizeObserver.all) {
      o.cb([{ contentRect: { width } } as ResizeObserverEntry], o as unknown as ResizeObserver);
    }
  }
}

const CONTENT = Array.from({ length: 20 }, (_, i) => (i === 14 ? "const area = width * height;" : `line ${i + 1}`)).join("\n");
// Line 15 changed, line 16 added; everything else unchanged.
const DIFF = [
  "--- a/src/geo/area.ts",
  "+++ b/src/geo/area.ts",
  "@@ -12,7 +12,8 @@",
  " line 12",
  " line 13",
  " line 14",
  "-const area = w * h;",
  "+const area = width * height;",
  "+line 16",
  " line 16",
  " line 17",
  " line 18",
].join("\n");
const NEW_CONTENT = CONTENT.split("\n");
NEW_CONTENT.splice(15, 0, "line 16");
const FULL = NEW_CONTENT.slice(0, 20).join("\n");

// Pure deletion: old lines 4-5 removed, line 6 becomes new line 4.
const DELETE_DIFF = ["--- a/notes.ts", "+++ b/notes.ts", "@@ -3,4 +3,2 @@", " line 3", "-gone 4", "-gone 5", " line 6"].join("\n");
const AFTER_DELETE = ["line 1", "line 2", "line 3", "line 6", "line 7"].join("\n");

const changed = (extra: Partial<Parameters<typeof FileViewer>[0]> = {}) => (
  <FileViewer path="src/geo/area.ts" diff={DIFF} content={FULL} status="M" counts={{ add: 2, del: 1 }} defaultMode="diff" {...extra} />
);

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  stubFetch({}, { ok: true });
});

describe("FileViewer", () => {
  it("header shows path, counts and the Diff | Code toggle", () => {
    render(changed({ uncommitted: true }));
    const header = screen.getByTestId("file-viewer-header");
    expect(header).toHaveTextContent("src/geo/area.ts");
    expect(within(header).getByText("area.ts").tagName).toBe("B");
    expect(header).toHaveTextContent("+2 −1");
    expect(header).toHaveTextContent("· modified, uncommitted");
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
  });

  it("unchanged file opens in Code without a toggle", () => {
    render(<FileViewer path="README.md" content={"# hi\nthere"} defaultMode="diff" />);
    expect(screen.queryByRole("button", { name: "Diff" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    expect(screen.getByTestId("file-viewer-header")).not.toHaveTextContent("+");
    expect(screen.getByTestId("file-viewer-body").querySelectorAll("tr[data-line]")).toHaveLength(2);
  });

  it("falls back to unified below 720px with Split disabled", () => {
    const { container } = render(changed());
    act(() => DrivenResizeObserver.resize(1000));
    expect(container.querySelector("table.fv-split")).not.toBeNull();
    act(() => DrivenResizeObserver.resize(600));
    const split = screen.getByRole("button", { name: "Split" });
    expect(split).toBeDisabled();
    expect(split).toHaveAttribute("title", "Needs a wider pane");
    expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("table.fv-unified")).not.toBeNull();
    // The stored layout is untouched by a narrow pane.
    expect(readPreference(preferences.fileViewerDiffLayout)).toBe("split");
  });

  it("remembers the diff layout across viewers", () => {
    const first = render(changed());
    fireEvent.click(screen.getByRole("button", { name: "Unified" }));
    expect(readPreference(preferences.fileViewerDiffLayout)).toBe("unified");
    first.unmount();
    const { container } = render(changed({ path: "src/other.ts" }));
    expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("table.fv-unified")).not.toBeNull();
  });

  it("expands a fold on click", () => {
    render(changed());
    const fold = screen.getByRole("button", { name: "⋯ Expand 11 unchanged lines" });
    expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="5"]')).toBeNull();
    fireEvent.click(fold);
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="5"]')).not.toBeNull();
  });

  it("marks only the changed tokens on both sides", () => {
    const { container } = render(changed());
    const marks = [...container.querySelectorAll("mark.fv-word")].map((m) => m.textContent);
    expect(marks).toEqual(["w", "h", "width", "height"]);
  });

  it("code mode legend and gutter markers render", () => {
    render(changed({ defaultMode: "code", uncommitted: true }));
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    const legend = screen.getByTestId("file-viewer-legend");
    expect(legend).toHaveTextContent("added");
    expect(legend).toHaveTextContent("changed");
    expect(legend).toHaveTextContent("removed");
    const body = screen.getByTestId("file-viewer-body");
    expect(body.querySelector('tr[data-line="15"]')).toHaveAttribute("data-mark", "changed");
    expect(body.querySelector('tr[data-line="16"]')).toHaveAttribute("data-mark", "added");
    expect(body.querySelector('tr[data-line="14"]')).not.toHaveAttribute("data-mark");
    expect(body.querySelectorAll("tr[data-line]")).toHaveLength(20);
  });

  it("scrollToLine flashes the target line", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(changed({ defaultMode: "code" }));
      const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
      scroll.mockClear();
      rerender(changed({ defaultMode: "code", scrollToLine: 7 }));
      const row = screen.getByTestId("file-viewer-body").querySelector('tr[data-line="7"]')!;
      expect(scroll).toHaveBeenCalled();
      expect(scroll.mock.contexts.at(-1)).toBe(row);
      expect(row).toHaveClass("fv-flash");
      act(() => vi.advanceTimersByTime(2000));
      expect(row).not.toHaveClass("fv-flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks highlight matches in both modes", () => {
    const { container } = render(changed({ highlight: "AREA" }));
    expect(container.querySelectorAll("mark.fv-hl").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect([...container.querySelectorAll("mark.fv-hl")].map((m) => m.textContent)).toEqual(["area"]);
  });

  it("identifiers are clickable in Code when onIdentifierClick is given", () => {
    const onIdentifierClick = vi.fn();
    const { container } = render(changed({ defaultMode: "code", onIdentifierClick }));
    const sym = [...container.querySelectorAll<HTMLElement>("[data-sym]")].find((s) => s.textContent === "height")!;
    fireEvent.click(sym);
    expect(onIdentifierClick).toHaveBeenCalledWith({ line: 15, col: 22 }, "height");
  });

  it("scrollToLine into a fold in Diff expands it and flashes the line", () => {
    const { rerender } = render(changed());
    const body = screen.getByTestId("file-viewer-body");
    expect(body.querySelector('tr[data-line="5"]')).toBeNull();
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    rerender(changed({ scrollToLine: 5 }));
    const row = body.querySelector('tr[data-line="5"]');
    expect(row).not.toBeNull();
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(scroll.mock.contexts.at(-1)).toBe(row);
    expect(row).toHaveClass("fv-flash");
  });

  it("re-requesting the same line with a new scrollKey flashes again", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(changed({ defaultMode: "code", scrollToLine: 7, scrollKey: 1 }));
      const row = () => screen.getByTestId("file-viewer-body").querySelector('tr[data-line="7"]')!;
      expect(row()).toHaveClass("fv-flash");
      act(() => vi.advanceTimersByTime(2000));
      expect(row()).not.toHaveClass("fv-flash");
      const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
      scroll.mockClear();
      rerender(changed({ defaultMode: "code", scrollToLine: 7, scrollKey: 2 }));
      expect(scroll.mock.contexts.at(-1)).toBe(row());
      expect(row()).toHaveClass("fv-flash");
      // A repeat while still flashing switches the animation so it restarts.
      const alt = row().classList.contains("fv-flash-alt");
      rerender(changed({ defaultMode: "code", scrollToLine: 7, scrollKey: 3 }));
      expect(row()).toHaveClass("fv-flash");
      expect(row().classList.contains("fv-flash-alt")).toBe(!alt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a pure deletion with a removed wedge on the following line in Code", () => {
    render(<FileViewer path="notes.ts" diff={DELETE_DIFF} content={AFTER_DELETE} status="M" defaultMode="code" />);
    const body = screen.getByTestId("file-viewer-body");
    expect(body.querySelector('tr[data-line="4"]')).toHaveAttribute("data-mark", "removed");
    expect(body.querySelector('tr[data-line="3"]')).not.toHaveAttribute("data-mark");
  });

  it("identifiers are not clickable in non-code files", () => {
    const { container } = render(<FileViewer path="README.md" content={"# Title\nsome words here"} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect(container.querySelectorAll("[data-sym]")).toHaveLength(0);
  });

  it("a binary diff says there is no text diff instead of content not loaded", () => {
    const diff = "diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n";
    render(<FileViewer path="logo.png" diff={diff} status="M" defaultMode="diff" />);
    expect(screen.getByTestId("file-viewer-body")).toHaveTextContent("Binary file — no text diff");
    expect(screen.queryByText("File content is not loaded.")).toBeNull();
  });

  it("a deleted binary file still reads as binary", () => {
    const diff = "diff --git a/logo.png b/logo.png\ndeleted file mode 100644\nBinary files a/logo.png and /dev/null differ\n";
    render(<FileViewer path="logo.png" diff={diff} status="D" defaultMode="diff" />);
    expect(screen.getByTestId("file-viewer-body")).toHaveTextContent("Binary file — no text diff");
  });
});
