import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TerminalDrawerProvider } from "../useTerminalDrawer";
import TerminalDrawer from "../TerminalDrawer";

vi.mock("../ProjectTerminalsSurface", () => ({
  __esModule: true,
  default: ({ projectName }: { projectName: string }) => (
    <div data-testid="surface">{projectName}</div>
  ),
}));

function renderAt(
  path: string,
  open: boolean,
  width = 480,
  side: "left" | "right" = "right",
) {
  if (open) localStorage.setItem("panel:terminalDrawer:open", "true");
  localStorage.setItem("panel:terminalDrawer:width", String(width));
  localStorage.setItem("panel:terminalDrawer:side", side);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TerminalDrawerProvider>
        <TerminalDrawer />
      </TerminalDrawerProvider>
    </MemoryRouter>,
  );
}

/**
 * Stands in for Layout's sidebar. The drawer is rendered without Layout here,
 * and jsdom rects are all zeros, so the width has to be stubbed explicitly.
 */
function mountSidebarStub(side: "left" | "right", width: number) {
  const el = document.createElement("div");
  el.setAttribute("data-testid", `layout-sidebar-${side}`);
  document.body.appendChild(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 768,
    width,
    height: 768,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

describe("TerminalDrawer", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    document
      .querySelectorAll('[data-testid^="layout-sidebar-"]')
      .forEach((el) => el.remove());
  });

  it("renders nothing when closed", () => {
    renderAt("/project/vector/memo", false);
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("renders nothing on the iterm tab even when the intent is open", () => {
    renderAt("/project/vector/iterm", true);
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("renders the current project's surface at the persisted width when open", () => {
    renderAt("/project/vector/memo", true, 520);
    const drawer = screen.getByTestId("terminal-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveStyle({ width: "520px" });
    expect(screen.getByTestId("surface")).toHaveTextContent("vector");
  });

  it("closes when the close button is clicked", () => {
    renderAt("/project/vector/memo", true);
    fireEvent.click(screen.getByTestId("terminal-drawer-close"));
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("does NOT close on Escape (passes through to the embedded terminal)", () => {
    renderAt("/project/vector/memo", true);
    expect(screen.getByTestId("terminal-drawer")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("terminal-drawer")).toBeInTheDocument();
  });

  it("docks right by default: handle on the inner (left) edge, order after main", () => {
    renderAt("/project/vector/memo", true);
    const drawer = screen.getByTestId("terminal-drawer");
    expect(drawer).toHaveAttribute("data-side", "right");
    expect(drawer).toHaveStyle({ order: "4" });
    expect(screen.getByTestId("terminal-drawer-resize")).toHaveAttribute(
      "data-edge",
      "left",
    );
  });

  it("docks left: handle on the inner (right) edge, order before main", () => {
    renderAt("/project/vector/memo", true, 480, "left");
    const drawer = screen.getByTestId("terminal-drawer");
    expect(drawer).toHaveAttribute("data-side", "left");
    expect(drawer).toHaveStyle({ order: "2" });
    expect(screen.getByTestId("terminal-drawer-resize")).toHaveAttribute(
      "data-edge",
      "right",
    );
  });

  it("grows on ArrowLeft when docked right", () => {
    renderAt("/project/vector/memo", true, 480);
    const handle = screen.getByTestId("terminal-drawer-resize");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ width: "496px" });
    expect(localStorage.getItem("panel:terminalDrawer:width")).toBe("496");
  });

  it("grows on ArrowRight when docked left", () => {
    renderAt("/project/vector/memo", true, 480, "left");
    const handle = screen.getByTestId("terminal-drawer-resize");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ width: "496px" });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ width: "480px" });
  });

  it("computes width from the distance to the right edge when docked right", () => {
    renderAt("/project/vector/memo", true, 480);
    const handle = screen.getByTestId("terminal-drawer-resize");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 544 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 424 });
    // jsdom viewport 1024 → 1024 - 424 = 600
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ width: "600px" });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 424 });
  });

  it("computes width from the drawer's left offset when docked left", () => {
    renderAt("/project/vector/memo", true, 480, "left");
    const drawer = screen.getByTestId("terminal-drawer");
    const handle = screen.getByTestId("terminal-drawer-resize");
    // jsdom's getBoundingClientRect() is all zeros, which makes
    // clientX - rect.left indistinguishable from a bare clientX. Stub a
    // non-zero left (as if a 240px sidebar sat beside the drawer) so the
    // subtraction is actually pinned: 800 - 240 = 560, not 800.
    vi.spyOn(drawer, "getBoundingClientRect").mockReturnValue({
      x: 240,
      y: 0,
      left: 240,
      top: 0,
      right: 720,
      bottom: 768,
      width: 480,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 720 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
    expect(drawer).toHaveStyle({ width: "560px" });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800 });
  });

  it("shows a drop zone on the half being dragged into, then docks there", () => {
    renderAt("/project/vector/memo", true);
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    expect(
      screen.queryByTestId("terminal-drawer-dropzone"),
    ).not.toBeInTheDocument();

    // jsdom viewport is 1024 → midpoint 512
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 200 });
    expect(screen.getByTestId("terminal-drawer-dropzone")).toHaveAttribute(
      "data-side",
      "left",
    );

    fireEvent.pointerUp(header, { pointerId: 1, clientX: 200 });
    expect(screen.getByTestId("terminal-drawer")).toHaveAttribute(
      "data-side",
      "left",
    );
    expect(localStorage.getItem("panel:terminalDrawer:side")).toBe("left");
    expect(
      screen.queryByTestId("terminal-drawer-dropzone"),
    ).not.toBeInTheDocument();
  });

  it("offsets the left drop zone by the measured left sidebar width", () => {
    mountSidebarStub("left", 241);
    renderAt("/project/vector/memo", true);
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 200 });

    const zone = screen.getByTestId("terminal-drawer-dropzone");
    expect(zone).toHaveAttribute("data-side", "left");
    expect(zone).toHaveStyle({ left: "241px" });
  });

  it("offsets the right drop zone by the measured right sidebar width", () => {
    mountSidebarStub("right", 265);
    renderAt("/project/vector/memo", true, 480, "left");
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 200 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 800 });

    const zone = screen.getByTestId("terminal-drawer-dropzone");
    expect(zone).toHaveAttribute("data-side", "right");
    expect(zone).toHaveStyle({ right: "265px" });
  });

  it("offsets the drop zone by 0 when the sidebar is collapsed to width 0", () => {
    mountSidebarStub("left", 0);
    renderAt("/project/vector/memo", true);
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 200 });

    expect(screen.getByTestId("terminal-drawer-dropzone")).toHaveStyle({
      left: "0px",
    });
  });

  it("falls back to a 0 offset when no sidebar element exists", () => {
    renderAt("/project/vector/memo", true);
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 200 });

    expect(screen.getByTestId("terminal-drawer-dropzone")).toHaveStyle({
      left: "0px",
    });
  });

  it("treats movement under the guard distance as a click, not a side change", () => {
    renderAt("/project/vector/memo", true);
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 803 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 803 });

    expect(screen.getByTestId("terminal-drawer")).toHaveAttribute(
      "data-side",
      "right",
    );
    expect(localStorage.getItem("panel:terminalDrawer:side")).toBe("right");
  });

  it("does not start a side drag from the close button", () => {
    renderAt("/project/vector/memo", true);
    const close = screen.getByTestId("terminal-drawer-close");

    fireEvent.pointerDown(close, { pointerId: 1, button: 0, clientX: 990 });
    fireEvent.pointerMove(screen.getByTestId("terminal-drawer-header"), {
      pointerId: 1,
      clientX: 100,
    });
    expect(
      screen.queryByTestId("terminal-drawer-dropzone"),
    ).not.toBeInTheDocument();
  });

  it("keeps the same drawer element across a side flip (no remount)", () => {
    renderAt("/project/vector/memo", true);
    const before = screen.getByTestId("terminal-drawer");
    const header = screen.getByTestId("terminal-drawer-header");

    fireEvent.pointerDown(header, { pointerId: 1, button: 0, clientX: 800 });
    fireEvent.pointerMove(header, { pointerId: 1, clientX: 120 });
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 120 });

    expect(screen.getByTestId("terminal-drawer")).toBe(before);
    expect(before).toHaveAttribute("data-side", "left");
  });
});
