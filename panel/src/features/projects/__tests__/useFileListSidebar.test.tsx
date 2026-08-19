import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  useFileListSidebar,
  FILE_LIST_SIDEBAR_KEY,
  MOBILE_QUERY,
} from "../useFileListSidebar";

/** Controllable matchMedia stub — jsdom has none. */
function installMatchMedia(mobile: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = mobile;
  const mql = {
    get matches() {
      return matches;
    },
    media: MOBILE_QUERY,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMobile(next: boolean) {
      matches = next;
      act(() => {
        listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
      });
    },
  };
}

function Probe() {
  const { collapsed, isMobile, peeking, toggle, collapseTransient, startPeek, endPeek } =
    useFileListSidebar();
  return (
    <div>
      <span data-testid="collapsed">{String(collapsed)}</span>
      <span data-testid="mobile">{String(isMobile)}</span>
      <span data-testid="peeking">{String(peeking)}</span>
      <button data-testid="toggle" onClick={toggle}>
        toggle
      </button>
      <button data-testid="select" onClick={collapseTransient}>
        select
      </button>
      <button data-testid="start-peek" onClick={startPeek}>
        start
      </button>
      <button data-testid="end-peek" onClick={endPeek}>
        end
      </button>
    </div>
  );
}

const collapsed = () => screen.getByTestId("collapsed").textContent;
const peeking = () => screen.getByTestId("peeking").textContent;
const stored = () => localStorage.getItem(FILE_LIST_SIDEBAR_KEY);

describe("useFileListSidebar", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults to expanded on desktop", () => {
    installMatchMedia(false);
    render(<Probe />);
    expect(collapsed()).toBe("false");
    expect(screen.getByTestId("mobile").textContent).toBe("false");
  });

  it("persists the desktop toggle", () => {
    installMatchMedia(false);
    render(<Probe />);
    fireEvent.click(screen.getByTestId("toggle"));
    expect(collapsed()).toBe("true");
    expect(stored()).toBe("true");
  });

  it("reads the stored value on mount", () => {
    installMatchMedia(false);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "true");
    render(<Probe />);
    expect(collapsed()).toBe("true");
  });

  it("ignores collapseTransient on desktop", () => {
    installMatchMedia(false);
    render(<Probe />);
    fireEvent.click(screen.getByTestId("select"));
    expect(collapsed()).toBe("false");
    expect(stored()).toBeNull();
  });

  it("starts collapsed on mobile even when storage says expanded", () => {
    installMatchMedia(true);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(<Probe />);
    expect(collapsed()).toBe("true");
  });

  it("toggling on mobile never writes storage", () => {
    installMatchMedia(true);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(<Probe />);
    fireEvent.click(screen.getByTestId("toggle"));
    expect(collapsed()).toBe("false");
    expect(stored()).toBe("false");
  });

  it("collapseTransient re-collapses on mobile without writing storage", () => {
    installMatchMedia(true);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(<Probe />);
    fireEvent.click(screen.getByTestId("toggle"));
    expect(collapsed()).toBe("false");
    fireEvent.click(screen.getByTestId("select"));
    expect(collapsed()).toBe("true");
    expect(stored()).toBe("false");
  });

  it("returning to desktop restores the stored preference", () => {
    const mm = installMatchMedia(true);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(<Probe />);
    expect(collapsed()).toBe("true");
    mm.setMobile(false);
    expect(collapsed()).toBe("false");
  });

  it("startPeek expands a stored-collapsed sidebar without writing storage", () => {
    installMatchMedia(false);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "true");
    render(<Probe />);
    expect(collapsed()).toBe("true");
    fireEvent.click(screen.getByTestId("start-peek"));
    expect(collapsed()).toBe("false");
    expect(peeking()).toBe("true");
    expect(stored()).toBe("true");
  });

  it("endPeek re-collapses the peek without writing storage", () => {
    installMatchMedia(false);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "true");
    render(<Probe />);
    fireEvent.click(screen.getByTestId("start-peek"));
    expect(collapsed()).toBe("false");
    fireEvent.click(screen.getByTestId("end-peek"));
    expect(collapsed()).toBe("true");
    expect(peeking()).toBe("false");
    expect(stored()).toBe("true");
  });

  it("toggle pins the sidebar open and clears an active peek", () => {
    installMatchMedia(false);
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "true");
    render(<Probe />);
    fireEvent.click(screen.getByTestId("start-peek"));
    expect(peeking()).toBe("true");
    fireEvent.click(screen.getByTestId("toggle"));
    // stored pref flips to expanded (pinned) and peek is cleared
    expect(collapsed()).toBe("false");
    expect(peeking()).toBe("false");
    expect(stored()).toBe("false");
  });

  it("while pinned open, peeking does not toggle the stored pref", () => {
    installMatchMedia(false);
    // stored expanded (pinned open)
    render(<Probe />);
    expect(collapsed()).toBe("false");
    fireEvent.click(screen.getByTestId("start-peek"));
    fireEvent.click(screen.getByTestId("end-peek"));
    expect(collapsed()).toBe("false");
    expect(stored()).toBeNull();
  });

  it("startPeek is a no-op when the sidebar is pinned open", () => {
    installMatchMedia(false);
    // stored expanded (pinned open) on desktop
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, "false");
    render(<Probe />);
    expect(collapsed()).toBe("false");
    fireEvent.click(screen.getByTestId("start-peek"));
    expect(peeking()).toBe("false");
    expect(collapsed()).toBe("false");
  });

  it("startPeek and endPeek are no-ops on mobile", () => {
    installMatchMedia(true);
    render(<Probe />);
    expect(collapsed()).toBe("true");
    fireEvent.click(screen.getByTestId("start-peek"));
    expect(collapsed()).toBe("true");
    expect(peeking()).toBe("false");
    fireEvent.click(screen.getByTestId("end-peek"));
    expect(collapsed()).toBe("true");
  });
});
