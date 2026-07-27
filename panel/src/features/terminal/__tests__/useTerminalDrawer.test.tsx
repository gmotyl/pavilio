import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  TerminalDrawerProvider,
  useTerminalDrawer,
} from "../useTerminalDrawer";

function Probe() {
  const { open, visible, suppressed, width } = useTerminalDrawer();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="visible">{String(visible)}</span>
      <span data-testid="suppressed">{String(suppressed)}</span>
      <span data-testid="width">{width}</span>
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
});
