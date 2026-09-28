import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileListSidebar from "../FileListSidebar";
import { MOBILE_QUERY } from "../../../lib/breakpoints";

// jsdom computes no layout, so nothing here may assert a pixel height. The
// contract under test is the class list the component renders.

function stubMatchMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      matches: mobile,
      media: MOBILE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const single = [
  { id: "project", label: "projects (current)", count: 2, rows: <p>rows</p> },
];

function renderSidebar(fillHeight?: boolean) {
  return render(
    <FileListSidebar
      testId="plans-tab"
      title="Plans"
      sources={single}
      detail={<p>the document</p>}
      fillHeight={fillHeight}
    />,
  );
}

const detail = () => screen.getByTestId("file-list-sidebar-detail");
const list = () => screen.getByTestId("file-list-sidebar");
/** The flex row that wraps the list and the detail pane. */
const row = () => detail().parentElement!;

const classesOf = (el: Element) => el.className.split(/\s+/).filter(Boolean);

describe("FileListSidebar fillHeight", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
  });

  it("renders no fill classes on the detail pane by default", () => {
    renderSidebar();
    const cls = classesOf(detail());
    expect(cls).toContain("flex-1");
    expect(cls).toContain("min-w-0");
    expect(cls).not.toContain("md:h-full");
    expect(cls).not.toContain("md:min-h-0");
    expect(cls).not.toContain("md:flex-1");
    expect(classesOf(list())).not.toContain("md:overflow-y-auto");
  });

  it("hands the detail pane the row's height when fillHeight is set", () => {
    renderSidebar(true);
    const cls = classesOf(detail());
    // Existing classes survive the append.
    expect(cls).toContain("flex-1");
    expect(cls).toContain("min-w-0");
    expect(cls).toContain("md:h-full");
    expect(cls).toContain("md:min-h-0");
  });

  it("height-bounds the row so the detail pane has something to fill", () => {
    renderSidebar(true);
    const cls = classesOf(row());
    expect(cls).toContain("flex");
    expect(cls).toContain("md:flex-row");
    expect(cls).toContain("gap-6");
    expect(cls).toContain("md:flex-1");
    expect(cls).toContain("md:min-h-0");
  });

  it("lets a long file list scroll inside the row rather than stretching it", () => {
    renderSidebar(true);
    const cls = classesOf(list());
    expect(cls).toContain("shrink-0");
    expect(cls).toContain("relative");
    expect(cls).toContain("md:min-h-0");
    expect(cls).toContain("md:overflow-y-auto");
  });

  it("keeps the fill on the detail pane when the list is collapsed to a rail", () => {
    renderSidebar(true);
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByTestId("file-list-sidebar-rail")).toBeTruthy();
    const cls = classesOf(detail());
    expect(cls).toContain("flex-1");
    expect(cls).toContain("min-w-0");
    expect(cls).toContain("md:h-full");
    expect(cls).toContain("md:min-h-0");
    const rowCls = classesOf(row());
    expect(rowCls).toContain("relative");
    expect(rowCls).toContain("flex-row");
    expect(rowCls).toContain("md:flex-1");
    expect(rowCls).toContain("md:min-h-0");
  });

  it("exposes the detail pane by test id in both the expanded and rail layouts", () => {
    const { unmount } = renderSidebar();
    expect(detail().textContent).toContain("the document");
    unmount();

    renderSidebar();
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByTestId("file-list-sidebar-rail")).toBeTruthy();
    expect(detail().textContent).toContain("the document");
  });
});
