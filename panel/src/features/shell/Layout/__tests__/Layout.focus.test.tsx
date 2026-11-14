import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installMatchMedia } from "../../../../test-utils";
import { preferences } from "../../../../preferences/declarations";
import { readPreference, writePreference } from "../../../../preferences/store";

vi.mock("../../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));

import { Layout, FloatingActionProvider } from "..";
import { TerminalDrawerProvider } from "../../../terminal/useTerminalDrawer";

/** The xterm DOM the shortcut has to beat — see `usePanelShortcut.test.tsx`. */
function mountXterm() {
  const host = document.createElement("div");
  host.className = "xterm";
  const textarea = document.createElement("textarea");
  textarea.className = "xterm-helper-textarea";
  host.appendChild(textarea);
  document.body.appendChild(host);
  const reached = vi.fn();
  textarea.addEventListener("keydown", reached);
  textarea.focus();
  return { host, textarea, reached };
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const ALT_SHIFT_F = { key: "Ï", code: "KeyF", altKey: true, shiftKey: true };

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/project/pavilio/iterm"]}>
      <FloatingActionProvider>
        <TerminalDrawerProvider>
          <Layout>
            <div>page content</div>
          </Layout>
        </TerminalDrawerProvider>
      </FloatingActionProvider>
    </MemoryRouter>,
  );
}

const breadcrumbRow = () => screen.queryByRole("navigation", { name: "Breadcrumb" });

let xterm: ReturnType<typeof mountXterm>;

beforeEach(() => {
  installMatchMedia();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});

afterEach(() => {
  xterm?.host.remove();
  vi.unstubAllGlobals();
});

describe("Layout focus layout", () => {
  it("Alt+Shift+F toggles focus from the terminal", () => {
    renderLayout();
    xterm = mountXterm();
    expect(breadcrumbRow()).toBeInTheDocument();

    const on = press(xterm.textarea, ALT_SHIFT_F);
    expect(readPreference(preferences.focusLayout)).toBe(true);
    expect(breadcrumbRow()).not.toBeInTheDocument();
    // The key never reaches the shell.
    expect(xterm.reached).not.toHaveBeenCalled();
    expect(on.defaultPrevented).toBe(true);

    // Holding the key auto-repeats; that must not keep flipping the layout.
    press(xterm.textarea, { ...ALT_SHIFT_F, repeat: true });
    press(xterm.textarea, { ...ALT_SHIFT_F, repeat: true });
    expect(readPreference(preferences.focusLayout)).toBe(true);
    expect(xterm.reached).not.toHaveBeenCalled();

    press(xterm.textarea, ALT_SHIFT_F);
    expect(readPreference(preferences.focusLayout)).toBe(false);
    expect(breadcrumbRow()).toBeInTheDocument();
  });

  it("toggling focus leaves the sidebar state and hamburger alone", () => {
    for (const expanded of [true, false]) {
      writePreference(preferences.leftSidebarExpanded, expanded);
      writePreference(preferences.focusLayout, false);
      const { unmount } = renderLayout();

      const sidebar = screen.getByTestId("layout-sidebar-left");
      const before = sidebar.className;

      act(() => screen.getByTestId("focus-layout-toggle").click());
      expect(readPreference(preferences.focusLayout)).toBe(true);
      expect(readPreference(preferences.leftSidebarExpanded)).toBe(expanded);
      expect(screen.getByTestId("layout-sidebar-left").className).toBe(before);
      expect(screen.getByTestId("sidebar-hamburger")).toHaveAttribute(
        "aria-expanded",
        String(expanded),
      );

      // And back off again: still untouched.
      xterm = mountXterm();
      press(xterm.textarea, ALT_SHIFT_F);
      xterm.host.remove();
      expect(readPreference(preferences.focusLayout)).toBe(false);
      expect(readPreference(preferences.leftSidebarExpanded)).toBe(expanded);
      expect(screen.getByTestId("sidebar-hamburger")).toHaveAttribute(
        "aria-expanded",
        String(expanded),
      );
      unmount();
    }
  });
});
