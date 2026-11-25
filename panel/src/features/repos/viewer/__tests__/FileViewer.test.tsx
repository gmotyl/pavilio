import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../../../../test-utils";
import { preferences } from "../../../../preferences/declarations";
import { readPreference } from "../../../../preferences/store";
import FileViewer from "../FileViewer";

// Paging is the same logic at any page size; a test that pages sets a small one instead of mounting thousands of rows.
const rowPage = vi.hoisted(() => ({ size: undefined as number | undefined }));
vi.mock("../rowPage", async (importOriginal) => {
  const real = await importOriginal<typeof import("../rowPage")>();
  return {
    get ROW_PAGE() {
      return rowPage.size ?? real.ROW_PAGE;
    },
  };
});

// Likewise the highlight cap: a test that crosses it sets a small one instead of building half a megabyte.
const highlightLimit = vi.hoisted(() => ({ chars: undefined as number | undefined }));
vi.mock("../../../markdown/highlightLimit", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../markdown/highlightLimit")>();
  return {
    get MAX_HIGHLIGHT_CHARS() {
      return highlightLimit.chars ?? real.MAX_HIGHLIGHT_CHARS;
    },
  };
});

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
  rowPage.size = undefined;
  highlightLimit.chars = undefined;
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
      const { rerender, container } = render(changed({ defaultMode: "code" }));
      const scroll = vi.mocked(Element.prototype.scrollTo);
      scroll.mockClear();
      rerender(changed({ defaultMode: "code", scrollToLine: 7 }));
      const row = screen.getByTestId("file-viewer-body").querySelector('tr[data-line="7"]')!;
      expect(scroll).toHaveBeenCalled();
      expect(scroll.mock.contexts.at(-1)).toBe(container);
      expect(row).toHaveClass("fv-flash");
      act(() => vi.advanceTimersByTime(2000));
      expect(row).not.toHaveClass("fv-flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a jump scrolls only the host box, landing the line just below the sticky header", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { top: this.matches('tr[data-line="7"]') ? 500 : 100 } as DOMRect;
    });
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "file-viewer-header" ? 36 : 0;
    });
    try {
      const { rerender, container } = render(changed({ defaultMode: "code" }));
      Object.defineProperty(container, "scrollTop", { configurable: true, value: 40 });
      const scroll = vi.mocked(Element.prototype.scrollTo);
      const outer = vi.mocked(HTMLElement.prototype.scrollIntoView);
      scroll.mockClear();
      outer.mockClear();
      rerender(changed({ defaultMode: "code", scrollToLine: 7 }));
      expect(outer).not.toHaveBeenCalled();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(container);
      // 40 scrolled + (500 − 100) offset − 36 header − 8 margin.
      expect(scroll.mock.calls[0][0]).toMatchObject({ top: 396 });
    } finally {
      rect.mockRestore();
      height.mockRestore();
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

  it("import specifiers are clickable in Code and click at a column inside the string", () => {
    const onIdentifierClick = vi.fn();
    const content = [
      "import { AuthService } from './auth.service';",
      'import type { M } from "../../interfaces/modules/module-metadata.interface";',
      "export * from './lib';",
      "import './side-effect';",
      "const lazy = () => import('./lazy');",
      "const cjs = require('./cjs');",
      "// import nope from './in-comment';",
      "const s = 'not a specifier';",
    ].join("\n");
    const { container } = render(<FileViewer path="src/auth/auth.controller.ts" content={content} defaultMode="code" onIdentifierClick={onIdentifierClick} />);
    const specs = [...container.querySelectorAll<HTMLElement>(".fv-spec")];
    expect(specs.map((s) => s.dataset.sym)).toEqual([
      "./auth.service",
      "../../interfaces/modules/module-metadata.interface",
      "./lib",
      "./side-effect",
      "./lazy",
      "./cjs",
    ]);
    expect(specs[0]).toHaveTextContent("'./auth.service'");
    expect(specs[0]).toHaveAttribute("title", "Open module");
    fireEvent.click(specs[0]);
    // Column of the first character inside the quotes.
    expect(onIdentifierClick).toHaveBeenLastCalledWith({ line: 1, col: 30 }, "./auth.service");
    fireEvent.click(specs[1]);
    expect(onIdentifierClick).toHaveBeenLastCalledWith({ line: 2, col: 25 }, "../../interfaces/modules/module-metadata.interface");
  });

  it("a from/import inside another string is not a specifier", () => {
    const content = [
      `const a = "imported from 'x'";`,
      "const b = `import('y')`;",
      `const c = 'say "from" here'; import z from './real';`,
    ].join("\n");
    const { container } = render(<FileViewer path="src/s.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./real"]);
  });

  it("a dynamic import with a bundler comment before its specifier still links it", () => {
    const content = [
      `const a = () => import(/* webpackChunkName: "a" */ './a');`,
      "const b = () => import(/* webpackPrefetch: true */ /* x */ './b');",
    ].join("\n");
    const { container } = render(<FileViewer path="src/s.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./a", "./b"]);
  });

  it("a long closed comment before a specifier still links it; a keyword inside a comment does not", () => {
    const content = [
      `const a = () => import(/* ${"x".repeat(300)} */ './far');`,
      `const b = () => import(/* from './no' */ './near');`,
      `/* import x from './quoted' */ const c = require(/* don't */ './c');`,
    ].join("\n");
    const { container } = render(<FileViewer path="src/s.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./far", "./near", "./c"]);
  });

  it("an unclosed block comment links nothing after it on that line", () => {
    const content = [`const a = () => import(/* './x' ; import y from './y';`, "*/ import z from './z';"].join("\n");
    const { container } = render(<FileViewer path="src/s.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./z"]);
  });

  it("a /* that is not a comment opener does not hide a later import on the line", () => {
    const content = `const pattern = /[from /*]/; import './real';`;
    const { container } = render(<FileViewer path="src/s.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./real"]);
  });

  it("a line too long to scan (minified code) gets no links, others still do", () => {
    const minified = Array.from({ length: 400 }, (_, i) => `require('./m${i}');`).join("");
    const content = [minified, "import x from './short';"].join("\n");
    const { container } = render(<FileViewer path="dist/app.js" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    const first = container.querySelector('tr[data-line="1"]')!;
    expect(first.querySelectorAll(".fv-sym")).toHaveLength(0);
    expect([...container.querySelectorAll<HTMLElement>(".fv-spec")].map((s) => s.dataset.sym)).toEqual(["./short"]);
  });

  it("a file too big to highlight links no specifiers, since comments are unknown", () => {
    highlightLimit.chars = 2000;
    const pad = Array.from({ length: 20 }, () => `const v = ${"1".repeat(90)};`);
    const content = ["// see import x from './in-comment'", "import y from './real';", ...pad].join("\n");
    expect(content.length).toBeGreaterThan(2000);
    const { container } = render(<FileViewer path="src/big.ts" content={content} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect(container.querySelector('tr[data-line="2"]')).not.toBeNull();
    expect(container.querySelectorAll(".fv-spec")).toHaveLength(0);
    // Path text is still no identifier, even without string classes.
    const syms = [...container.querySelectorAll<HTMLElement>(".fv-sym")].map((s) => s.dataset.sym);
    expect(syms).not.toContain("comment");
    expect(syms).not.toContain("real");
  });

  it("import specifiers stay plain outside TS/JS", () => {
    const { container } = render(<FileViewer path="src/x.py" content={"from os import path"} defaultMode="code" onIdentifierClick={vi.fn()} />);
    expect(container.querySelectorAll(".fv-spec")).toHaveLength(0);
  });

  it("scrollToLine into a fold in Diff expands it and flashes the line", () => {
    const { rerender, container } = render(changed());
    const body = screen.getByTestId("file-viewer-body");
    expect(body.querySelector('tr[data-line="5"]')).toBeNull();
    const scroll = vi.mocked(Element.prototype.scrollTo);
    scroll.mockClear();
    rerender(changed({ scrollToLine: 5 }));
    const row = body.querySelector('tr[data-line="5"]');
    expect(row).not.toBeNull();
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(scroll.mock.contexts.at(-1)).toBe(container);
    expect(row).toHaveClass("fv-flash");
  });

  it("an old-side jump lands on the removed rows, switching Code to Diff", () => {
    const viewer = (extra: Partial<Parameters<typeof FileViewer>[0]> = {}) => (
      <FileViewer path="notes.ts" diff={DELETE_DIFF} content={AFTER_DELETE} status="M" defaultMode="code" {...extra} />
    );
    const { rerender, container } = render(viewer());
    const scroll = vi.mocked(Element.prototype.scrollTo);
    scroll.mockClear();
    rerender(viewer({ scrollToLine: 4, scrollSide: "old", scrollKey: 1 }));
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    const row = screen.getByTestId("file-viewer-body").querySelector('tr[data-old-line="4"]');
    expect(row).toHaveTextContent("gone 4");
    expect(row).toHaveClass("fv-flash");
    expect(scroll.mock.contexts.at(-1)).toBe(container);
  });

  it("an emptied file's old-side jump lands on its removed rows", () => {
    const emptied = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +0,0 @@", "-one", "-two"].join("\n");
    const { rerender } = render(<FileViewer path="x.ts" diff={emptied} content="" status="M" defaultMode="diff" />);
    rerender(<FileViewer path="x.ts" diff={emptied} content="" status="M" defaultMode="diff" scrollToLine={1} scrollSide="old" scrollKey={1} />);
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-old-line="1"]')).toHaveClass("fv-flash");
  });

  it("re-requesting the same line with a new scrollKey flashes again", () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = render(changed({ defaultMode: "code", scrollToLine: 7, scrollKey: 1 }));
      const row = () => screen.getByTestId("file-viewer-body").querySelector('tr[data-line="7"]')!;
      expect(row()).toHaveClass("fv-flash");
      act(() => vi.advanceTimersByTime(2000));
      expect(row()).not.toHaveClass("fv-flash");
      const scroll = vi.mocked(Element.prototype.scrollTo);
      scroll.mockClear();
      rerender(changed({ defaultMode: "code", scrollToLine: 7, scrollKey: 2 }));
      expect(scroll.mock.contexts.at(-1)).toBe(container);
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

  it("an empty script with identifier links and a search term renders without crashing", () => {
    render(<FileViewer path="src/empty.ts" content="" defaultMode="code" highlight="x" onIdentifierClick={vi.fn()} />);
    expect(screen.getByTestId("file-viewer-body").querySelectorAll("tr[data-line]")).toHaveLength(0);
  });

  it("a mode-only change shows the old and new mode", () => {
    const diff = "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
    render(<FileViewer path="run.sh" diff={diff} content={"echo hi\n"} status="M" uncommitted defaultMode="diff" />);
    expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("mode 100644 → 100755");
  });

  it("without the whole file, Code is unavailable instead of showing a diff's first hunk as the file", () => {
    const diff = "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,4 +1,4 @@\n-a\n+b\n c\n d\n e";
    render(<FileViewer path="src/x.ts" diff={diff} status="M" defaultMode="code" />);
    expect(screen.getByTestId("file-viewer-body")).toHaveTextContent("File content is not loaded.");
    fireEvent.click(screen.getByTestId("file-viewer-mode-diff"));
    expect(screen.getByTestId("file-viewer-mode-diff")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-viewer-body")).not.toHaveTextContent("File content is not loaded.");
  });

  it("mounts long files in pages and grows to reach a jump target", () => {
    rowPage.size = 50;
    const content = Array.from({ length: 120 }, (_, i) => `l${i + 1}`).join("\n");
    const { rerender } = render(<FileViewer path="big.txt" content={content} defaultMode="code" />);
    const rows = () => screen.getByTestId("file-viewer-body").querySelectorAll("tr[data-line]").length;
    expect(rows()).toBe(50);
    fireEvent.click(screen.getByTestId("file-viewer-more"));
    expect(rows()).toBe(100);
    rerender(<FileViewer path="big.txt" content={content} defaultMode="code" scrollToLine={115} scrollKey={1} />);
    expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="115"]')).not.toBeNull();
    expect(screen.queryByTestId("file-viewer-more")).toBeNull();
  });

  it("split view pages paired rows, so a replaced block never shows false blanks", () => {
    // 2n raw rows overflow a page, n paired rows fit it: paging raw rows would cut the block mid-way.
    rowPage.size = 50;
    const n = 40;
    const diff = [
      "--- a/big.txt",
      "+++ b/big.txt",
      `@@ -1,${n} +1,${n} @@`,
      ...Array.from({ length: n }, (_, i) => `-old${i + 1}`),
      ...Array.from({ length: n }, (_, i) => `+new${i + 1}`),
    ].join("\n");
    const { container } = render(<FileViewer path="big.txt" diff={diff} defaultMode="diff" />);
    act(() => DrivenResizeObserver.resize(1000));
    expect(container.querySelector("table.fv-split")).not.toBeNull();
    // Every mounted row pairs a removal with its replacement.
    expect(container.querySelectorAll("td.fv-s-empty")).toHaveLength(0);
    expect(container.querySelectorAll("tr.fv-r-change")).toHaveLength(n);
    expect(screen.queryByTestId("file-viewer-more")).toBeNull();
  });
});
