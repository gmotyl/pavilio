import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipboardList } from "lucide-react";
import FileListSidebar from "../FileListSidebar";
import { FILE_LIST_SIDEBAR_KEY, MOBILE_QUERY } from "../useFileListSidebar";

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

const single = [{ id: "project", label: "projects (current)", count: 2, rows: <p>rows</p> }];
const multi = [
  ...single,
  { id: "claude", label: "~/.claude/plans", count: 3, rows: <p>claude rows</p> },
];

describe("FileListSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
  });

  it("shows title, total count and the detail pane", () => {
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        icon={<ClipboardList size={16} />}
        sources={single}
        detail={<p>the document</p>}
      />,
    );
    expect(screen.getByText("Plans")).toBeTruthy();
    expect(screen.getByTestId("plans-tab-count").textContent).toBe("2");
    expect(screen.getByText("the document")).toBeTruthy();
    expect(screen.getByText("rows")).toBeTruthy();
  });

  it("omits group rows for a single source", () => {
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={single} detail={null} />,
    );
    expect(screen.queryByTestId("plans-tab-source-project")).toBeNull();
  });

  it("renders a group row per source when there are several", () => {
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={multi} detail={null} />,
    );
    expect(screen.getByTestId("plans-tab-source-project")).toBeTruthy();
    expect(screen.getByTestId("plans-tab-source-claude")).toBeTruthy();
  });

  it("collapses a source group on click", () => {
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={multi} detail={null} />,
    );
    expect(screen.getByText("claude rows")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plans-tab-source-claude"));
    expect(screen.queryByText("claude rows")).toBeNull();
  });

  it("renders a refresh button only when onRefresh is given", () => {
    const onRefresh = vi.fn();
    const { unmount } = render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={single}
        detail={null}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId("plans-tab-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    unmount();
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={single} detail={null} />,
    );
    expect(screen.queryByTestId("plans-tab-refresh")).toBeNull();
  });

  it("lets a source wrap its own header", () => {
    const sources = [
      {
        ...multi[0],
        renderHeader: (h: React.ReactNode) => (
          <div data-testid="wrapped-header">{h}</div>
        ),
      },
      multi[1],
    ];
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={sources} detail={null} />,
    );
    const wrapper = screen.getByTestId("wrapped-header");
    expect(wrapper.querySelector('[data-testid="plans-tab-source-project"]')).toBeTruthy();
  });

  it("collapses to a rail that keeps the detail pane", () => {
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={single}
        detail={<p>the document</p>}
      />,
    );
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.queryByText("rows")).toBeNull();
    expect(screen.getByText("the document")).toBeTruthy();
    expect(screen.getByTestId("file-list-sidebar-toggle")).toBeTruthy();
  });

  it("starts collapsed on mobile", () => {
    stubMatchMedia(true);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(
      <FileListSidebar testId="plans-tab" title="Plans" sources={single} detail={null} />,
    );
    expect(screen.queryByText("rows")).toBeNull();
  });

  // --- desktop hover-peek popup -------------------------------------------
  const peekSingle = [
    {
      id: "project",
      label: "projects (current)",
      count: 1,
      rows: (
        <button data-file-row data-testid="section-files-file-a.md">
          a.md
        </button>
      ),
    },
  ];

  function renderCollapsed(sources = peekSingle) {
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={sources}
        detail={<p>the document</p>}
      />,
    );
    // Collapse (pins to a stored-collapsed rail) on desktop.
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
  }

  it("opens the file list as an overlay popup when the collapsed rail is hovered", () => {
    renderCollapsed();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("file-list-sidebar-rail"));
    // Overlay popup renders the full list content.
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
    expect(screen.getByTestId("section-files-file-a.md")).toBeTruthy();
    // Toggle now reflects the effective-expanded state.
    expect(
      screen.getByTestId("file-list-sidebar-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    // The detail pane stays mounted behind the popup (no reflow away).
    expect(screen.getByText("the document")).toBeTruthy();
  });

  it("collapses the peek when the mouse leaves the overlay", () => {
    renderCollapsed();
    fireEvent.mouseEnter(screen.getByTestId("file-list-sidebar-rail"));
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
    fireEvent.mouseLeave(screen.getByTestId("file-list-sidebar-peek"));
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
  });

  it("collapses the peek when a file row is selected", () => {
    renderCollapsed();
    fireEvent.mouseEnter(screen.getByTestId("file-list-sidebar-rail"));
    fireEvent.click(screen.getByTestId("section-files-file-a.md"));
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
  });

  it("keeps the peek open when a non-row control inside it is clicked", () => {
    const sources = [
      {
        ...peekSingle[0],
        rows: (
          <div>
            <button data-testid="not-a-row">group</button>
            <button data-file-row data-testid="section-files-file-a.md">
              a.md
            </button>
          </div>
        ),
      },
    ];
    renderCollapsed(sources);
    fireEvent.mouseEnter(screen.getByTestId("file-list-sidebar-rail"));
    fireEvent.click(screen.getByTestId("not-a-row"));
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
  });

  it("renders the pinned-open sidebar inline, not as an overlay popup", () => {
    // Default desktop state is expanded (pinned open) — never an overlay.
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={peekSingle}
        detail={<p>the document</p>}
      />,
    );
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.getByTestId("section-files-file-a.md")).toBeTruthy();
  });

  it("does not peek on mobile hover", () => {
    stubMatchMedia(true);
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={peekSingle}
        detail={<p>the document</p>}
      />,
    );
    // Mobile starts collapsed; the rail exists but hover must do nothing.
    const rail = screen.getByTestId("file-list-sidebar-rail");
    fireEvent.mouseEnter(rail);
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
  });
});
