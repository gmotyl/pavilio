import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ClipboardList } from "lucide-react";
import FileListSidebar from "../FileListSidebar";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { usePeekTriggerProps } from "../peekTrigger";
import { installMatchMedia } from "../../../test-utils";

/** Stand-in for the open-file name inside `detail` — the real peek trigger. */
function PeekProbe() {
  const peek = usePeekTriggerProps();
  return (
    <div>
      <span data-testid="file-list-peek-trigger" {...peek}>
        some-file.md
      </span>
      <p>the document</p>
    </div>
  );
}

const single = [{ id: "project", label: "projects (current)", count: 2, rows: <p>rows</p> }];
const multi = [
  ...single,
  { id: "claude", label: "~/.claude/plans", count: 3, rows: <p>claude rows</p> },
];

describe("FileListSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia();
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
    installMatchMedia({ mobile: true });
    writePreference(preferences.fileListSidebarCollapsed, false);
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
        detail={<PeekProbe />}
      />,
    );
    // Collapse (pins to a stored-collapsed rail) on desktop.
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
  }

  const trigger = () => screen.getByTestId("file-list-peek-trigger");

  it("opens the file list as an overlay popup when the file-name trigger is hovered", () => {
    renderCollapsed();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
    fireEvent.mouseEnter(trigger());
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

  it("does not open the peek when the toggle button itself is hovered", () => {
    // The button is a pure manual toggle — hovering it must never peek.
    renderCollapsed();
    fireEvent.mouseEnter(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
  });

  it("keeps the rail in flow while peeking so the detail does not reflow", () => {
    // The rail stays mounted in-flow whether or not a peek is active, so opening
    // the overlay never shifts the detail pane.
    renderCollapsed();
    fireEvent.mouseEnter(trigger());
    expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
    expect(screen.getByTestId("file-list-sidebar-rail")).toBeTruthy();
    expect(screen.getByText("the document")).toBeTruthy();
  });

  it("fires the file row's own onClick before collapsing the peek", () => {
    const onSelect = vi.fn();
    const sources = [
      {
        id: "project",
        label: "projects (current)",
        count: 1,
        rows: (
          <button
            data-file-row
            data-testid="section-files-file-a.md"
            onClick={onSelect}
          >
            a.md
          </button>
        ),
      },
    ];
    renderCollapsed(sources);
    fireEvent.mouseEnter(trigger());
    fireEvent.click(screen.getByTestId("section-files-file-a.md"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
  });

  it("collapses the peek after the mouse leaves the overlay (grace delay)", () => {
    vi.useFakeTimers();
    try {
      renderCollapsed();
      fireEvent.mouseEnter(trigger());
      expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
      fireEvent.mouseLeave(screen.getByTestId("file-list-sidebar-peek"));
      // Still open during the grace window.
      expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
      act(() => vi.advanceTimersByTime(200));
      expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not collapse when re-entered within the grace window (no flicker)", () => {
    // Leaving the overlay and re-entering the file-name trigger within the grace
    // window cancels the pending close instead of flickering.
    vi.useFakeTimers();
    try {
      renderCollapsed();
      fireEvent.mouseEnter(trigger());
      fireEvent.mouseLeave(screen.getByTestId("file-list-sidebar-peek"));
      fireEvent.mouseEnter(trigger());
      act(() => vi.advanceTimersByTime(200));
      expect(screen.getByTestId("file-list-sidebar-peek")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
    fireEvent.mouseEnter(trigger());
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
        detail={<PeekProbe />}
      />,
    );
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.getByTestId("section-files-file-a.md")).toBeTruthy();
  });

  it("does not peek on mobile hover", () => {
    installMatchMedia({ mobile: true });
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={peekSingle}
        detail={<PeekProbe />}
      />,
    );
    // Mobile starts collapsed; the trigger exists but hover must do nothing.
    fireEvent.mouseEnter(trigger());
    expect(screen.queryByTestId("file-list-sidebar-peek")).toBeNull();
    expect(screen.queryByTestId("section-files-file-a.md")).toBeNull();
  });

  // --- mobile collapsed row ------------------------------------------------
  function renderMobileCollapsed(openPath: string | null = "plans/some-file.md") {
    installMatchMedia({ mobile: true });
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={single}
        detail={<p>the document</p>}
        openPath={openPath}
      />,
    );
  }

  it("collapsed list on mobile renders a row above the document", () => {
    renderMobileCollapsed();
    expect(screen.queryByTestId("file-list-sidebar-rail")).toBeNull();
    const row = screen.getByTestId("file-list-sidebar-row");
    const detail = screen.getByTestId("file-list-sidebar-detail");
    expect(row.contains(screen.getByTestId("file-list-sidebar-toggle"))).toBe(true);
    // The row precedes the detail in document order.
    expect(
      row.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapsed row shows the open file path", () => {
    renderMobileCollapsed();
    const path = screen.getByTestId("file-list-sidebar-path");
    expect(path.textContent).toBe("plans/some-file.md");
    expect(path.title).toBe("plans/some-file.md");
    expect(path.className).toContain("min-w-0");
    expect(screen.getByTestId("file-list-sidebar-row").contains(path)).toBe(true);
  });

  it("collapsed row keeps the file name of a long path visible", () => {
    const long =
      "projects/pavilio/plans/openspec/changes/2026-10-27-navigation-polish/design.md";
    renderMobileCollapsed(long);
    const path = screen.getByTestId("file-list-sidebar-path");
    const dir = screen.getByTestId("file-list-sidebar-path-dir");
    const name = screen.getByTestId("file-list-sidebar-path-name");
    expect(path.textContent).toBe(long);
    // The directories take the ellipsis; the file name never shrinks.
    expect(dir.textContent).toBe(
      "projects/pavilio/plans/openspec/changes/2026-10-27-navigation-polish/",
    );
    expect(Array.from(dir.classList)).toEqual(
      expect.arrayContaining(["truncate", "min-w-0"]),
    );
    expect(name.textContent).toBe("design.md");
    expect(name.classList).toContain("shrink-0");
    // The name comes last, at the visible end of the row.
    expect(path.lastElementChild).toBe(name);
  });

  it("collapsed row shows a bare file name without a directory part", () => {
    renderMobileCollapsed("README.md");
    expect(screen.queryByTestId("file-list-sidebar-path-dir")).toBeNull();
    expect(screen.getByTestId("file-list-sidebar-path-name").textContent).toBe("README.md");
  });

  it("collapsed row shows only the toggle when no file is open", () => {
    renderMobileCollapsed(null);
    expect(screen.getByTestId("file-list-sidebar-row")).toBeTruthy();
    expect(screen.queryByTestId("file-list-sidebar-path")).toBeNull();
  });

  it("collapsed mobile document is full width", () => {
    renderMobileCollapsed();
    const detail = screen.getByTestId("file-list-sidebar-detail");
    const container = detail.parentElement!;
    expect(container.className).not.toContain("flex-row");
    expect(container.className).toContain("flex-col");
  });

  it("tapping the collapsed row toggle expands the list", () => {
    renderMobileCollapsed();
    expect(screen.queryByText("rows")).toBeNull();
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByText("rows")).toBeTruthy();
    expect(screen.queryByTestId("file-list-sidebar-row")).toBeNull();
    // Stacked: the list comes before the document.
    const list = screen.getByTestId("file-list-sidebar");
    const detail = screen.getByTestId("file-list-sidebar-detail");
    expect(
      list.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("desktop collapsed list keeps the rail", () => {
    render(
      <FileListSidebar
        testId="plans-tab"
        title="Plans"
        sources={single}
        detail={<p>the document</p>}
        openPath="plans/some-file.md"
      />,
    );
    fireEvent.click(screen.getByTestId("file-list-sidebar-toggle"));
    expect(screen.getByTestId("file-list-sidebar-rail")).toBeTruthy();
    expect(screen.queryByTestId("file-list-sidebar-row")).toBeNull();
    expect(screen.queryByTestId("file-list-sidebar-path")).toBeNull();
    const container = screen.getByTestId("file-list-sidebar-detail").parentElement!;
    expect(container.className).toContain("flex-row");
  });
});
