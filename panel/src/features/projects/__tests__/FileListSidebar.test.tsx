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
});
