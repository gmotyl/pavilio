/**
 * Alt+Shift+W: open the kill confirmation for the focused session of the
 * surface the keypress targets (same store as the fullscreen shortcuts).
 */
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useId } from "react";
import { setSurfaceRoot, unregisterTerminalSurface } from "../focusedTerminalSurface";
import { useCloseFocusedShortcut } from "../useCloseFocusedShortcut";

const sessions = [
  { id: "s1", name: "alpha" },
  { id: "s2", name: "beta" },
];

function Surface({ kill, hidden = false, tag }: { kill: (id: string) => void; hidden?: boolean; tag: string }) {
  const id = useId();
  const element = useCloseFocusedShortcut({ surfaceId: id, sessions, kill });
  return (
    <div hidden={hidden}>
      <div ref={(r) => (r ? setSurfaceRoot(id, r) : unregisterTerminalSurface(id))}>
        {sessions.map((s) => (
          <div key={s.id} data-terminal-cell={s.id}>
            <div className="xterm">
              <textarea data-testid={`${tag}-xterm-${s.id}`} />
            </div>
            <textarea data-testid={`${tag}-composer-${s.id}`} />
          </div>
        ))}
        <button data-testid={`${tag}-toolbar`}>tb</button>
      </div>
      {element}
    </div>
  );
}

function press(target: Element = document.activeElement ?? document.body) {
  const e = new KeyboardEvent("keydown", { code: "KeyW", key: "W", altKey: true, shiftKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

function stubMobile(matches: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useCloseFocusedShortcut", () => {
  it("alt shift w from xterm opens confirmation for focused session", () => {
    const kill = vi.fn();
    const { unmount } = render(<Surface kill={kill} tag="a" />);
    const xterm = screen.getByTestId("a-xterm-s2");
    act(() => xterm.focus());
    const e = press(xterm);
    expect(e.defaultPrevented).toBe(true);
    expect(screen.getByText(/beta/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close/i }));
    expect(kill).toHaveBeenCalledWith("s2");
    unmount();
  });

  it("alt shift w from composer targets its session", () => {
    const { unmount } = render(<Surface kill={() => {}} tag="a" />);
    const composer = screen.getByTestId("a-composer-s1");
    act(() => composer.focus());
    press(composer);
    expect(screen.getByText(/alpha/)).toBeTruthy();
    expect(screen.queryByText(/beta/)).toBeNull();
    unmount();
  });

  it("no focused session is a no-op", () => {
    const { unmount } = render(<Surface kill={() => {}} tag="a" />);
    const tb = screen.getByTestId("a-toolbar");
    act(() => tb.focus());
    const e = press(tb);
    expect(e.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/alpha|beta/)).toBeNull();
    unmount();
  });

  it("not bound on mobile", () => {
    stubMobile(true);
    const { unmount } = render(<Surface kill={() => {}} tag="a" />);
    const xterm = screen.getByTestId("a-xterm-s1");
    act(() => xterm.focus());
    const e = press(xterm);
    expect(e.defaultPrevented).toBe(false);
    expect(screen.queryByText(/alpha/)).toBeNull();
    unmount();
  });

  it("hidden surface does not react", () => {
    const { unmount } = render(
      <>
        <Surface kill={() => {}} tag="vis" />
        <Surface kill={() => {}} tag="hid" hidden />
      </>,
    );
    const hx = screen.getByTestId("hid-xterm-s1");
    act(() => hx.focus());
    const e = press(hx);
    expect(e.defaultPrevented).toBe(false);
    expect(screen.queryByText(/alpha/)).toBeNull();
    unmount();
  });
});
