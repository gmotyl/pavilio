import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  TerminalDrawerProvider,
  useTerminalDrawer,
} from "../useTerminalDrawer";

function Probe() {
  const { open, visible, suppressed, width, maxWidth, setWidth } = useTerminalDrawer();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="visible">{String(visible)}</span>
      <span data-testid="suppressed">{String(suppressed)}</span>
      <span data-testid="width">{width}</span>
      <span data-testid="max">{maxWidth}</span>
      <button data-testid="grow" onClick={() => setWidth(5000)}>
        grow
      </button>
      <button data-testid="to-iterm" onClick={() => navigate("/project/vector/iterm")}>
        iterm
      </button>
      <button data-testid="to-memo" onClick={() => navigate("/project/vector/memo")}>
        memo
      </button>
      <button data-testid="to-settings" onClick={() => navigate("/settings")}>
        settings
      </button>
    </div>
  );
}

const JSDOM_VIEWPORT = 1024;

function setViewport(value: number) {
  Object.defineProperty(window, "innerWidth", {
    value,
    writable: true,
    configurable: true,
  });
}

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TerminalDrawerProvider>
        <Probe />
      </TerminalDrawerProvider>
    </MemoryRouter>,
  );
}

describe("useTerminalDrawer", () => {
  beforeEach(() => localStorage.clear());

  // runs even if a test throws mid-body, so a viewport override can't leak
  afterEach(() => {
    setViewport(JSDOM_VIEWPORT);
  });

  it("starts closed and toggles open on Cmd+B when on a non-iterm project page", () => {
    setup("/project/vector/memo");
    expect(screen.getByTestId("open")).toHaveTextContent("false");
    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });
    expect(screen.getByTestId("open")).toHaveTextContent("true");
  });

  it("does not open on the iterm tab", () => {
    setup("/project/vector/iterm");
    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("does not open when there is no active project", () => {
    setup("/settings");
    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("restores persisted open + width state", () => {
    localStorage.setItem("panel:terminalDrawer:open", "true");
    localStorage.setItem("panel:terminalDrawer:width", "540");
    setup("/project/vector/memo");
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(screen.getByTestId("width")).toHaveTextContent("540");
  });

  it("keeps the open intent when navigating to the iterm tab, and restores it on the way back", () => {
    localStorage.setItem("panel:terminalDrawer:open", "true");
    setup("/project/vector/memo");
    expect(screen.getByTestId("visible")).toHaveTextContent("true");

    act(() => {
      fireEvent.click(screen.getByTestId("to-iterm"));
    });
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
    expect(screen.getByTestId("visible")).toHaveTextContent("false");
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(localStorage.getItem("panel:terminalDrawer:open")).toBe("true");

    act(() => {
      fireEvent.click(screen.getByTestId("to-memo"));
    });
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
  });

  it("keeps the open intent when navigating to a non-project route", () => {
    localStorage.setItem("panel:terminalDrawer:open", "true");
    setup("/project/vector/memo");

    act(() => {
      fireEvent.click(screen.getByTestId("to-settings"));
    });
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
    expect(screen.getByTestId("visible")).toHaveTextContent("false");
    expect(localStorage.getItem("panel:terminalDrawer:open")).toBe("true");

    act(() => {
      fireEvent.click(screen.getByTestId("to-memo"));
    });
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
  });

  it("makes Cmd+B a no-op while suppressed, leaving the stored intent alone", () => {
    localStorage.setItem("panel:terminalDrawer:open", "true");
    setup("/project/vector/iterm");
    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(localStorage.getItem("panel:terminalDrawer:open")).toBe("true");
  });

  it("caps width at viewport minus the main-content floor, not a fixed 900", () => {
    setup("/project/vector/memo");
    // jsdom viewport is 1024 wide → 1024 - 360 = 664
    expect(screen.getByTestId("max")).toHaveTextContent("664");
    act(() => {
      fireEvent.click(screen.getByTestId("grow"));
    });
    expect(screen.getByTestId("width")).toHaveTextContent("664");
    expect(localStorage.getItem("panel:terminalDrawer:width")).toBe("664");
  });

  it("re-clamps the effective width when the window shrinks, without rewriting the stored value", () => {
    localStorage.setItem("panel:terminalDrawer:width", "640");
    setup("/project/vector/memo");
    expect(screen.getByTestId("width")).toHaveTextContent("640");

    act(() => {
      setViewport(800);
      fireEvent(window, new Event("resize"));
    });

    // 800 - 360 = 440
    expect(screen.getByTestId("width")).toHaveTextContent("440");
    expect(screen.getByTestId("max")).toHaveTextContent("440");
    expect(localStorage.getItem("panel:terminalDrawer:width")).toBe("640");

    // regrowing the viewport restores the full stored preference
    act(() => {
      setViewport(JSDOM_VIEWPORT);
      fireEvent(window, new Event("resize"));
    });
    expect(screen.getByTestId("width")).toHaveTextContent("640");
  });
});
