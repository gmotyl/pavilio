import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePanelShortcut } from "../usePanelShortcut";
import { installMatchMedia } from "../../../test-utils";

/**
 * The xterm DOM the shortcut has to beat: xterm listens for keys on its hidden
 * helper textarea, so a listener there stands in for the shell receiving the
 * key. Built by hand — xterm itself does not render in jsdom.
 */
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
  target.dispatchEvent(event);
  return event;
}

let xterm: ReturnType<typeof mountXterm>;

beforeEach(() => {
  installMatchMedia();
  xterm = mountXterm();
});

afterEach(() => {
  xterm.host.remove();
});

describe("usePanelShortcut", () => {
  it("fires on Alt+Shift+code from inside an xterm textarea and stops propagation", () => {
    const handler = vi.fn();
    renderHook(() => usePanelShortcut("KeyF", handler));

    const event = press(xterm.textarea, { key: "F", code: "KeyF", altKey: true, shiftKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBe(event);
    // Capture phase on `window`: the key is stopped before it reaches xterm.
    expect(xterm.reached).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches event.code regardless of composed key", () => {
    const handler = vi.fn();
    renderHook(() => usePanelShortcut("KeyF", handler));

    // macOS Option+Shift+F composes `Ï`; the physical key is still KeyF.
    press(xterm.textarea, { key: "Ï", code: "KeyF", altKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);

    // And the composed key alone matches nothing: a layout that types `F` on
    // another physical key does not fire it.
    press(xterm.textarea, { key: "F", code: "KeyG", altKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores extra modifiers and Alt without Shift", () => {
    const handler = vi.fn();
    renderHook(() => usePanelShortcut("KeyO", handler));

    const misses: KeyboardEventInit[] = [
      { key: "O", code: "KeyO", altKey: true, shiftKey: true, metaKey: true },
      { key: "O", code: "KeyO", altKey: true, shiftKey: true, ctrlKey: true },
      { key: "o", code: "KeyO", altKey: true },
      { key: "O", code: "KeyO", shiftKey: true },
      { key: "o", code: "KeyO" },
    ];
    for (const init of misses) {
      const event = press(xterm.textarea, init);
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
    }

    expect(handler).not.toHaveBeenCalled();
    // Every miss passes through to the terminal untouched.
    expect(xterm.reached).toHaveBeenCalledTimes(misses.length);
  });

  it("is inactive below md", () => {
    installMatchMedia({ mobile: true });
    const handler = vi.fn();
    renderHook(() => usePanelShortcut("KeyT", handler));

    const event = press(xterm.textarea, { key: "T", code: "KeyT", altKey: true, shiftKey: true });

    expect(handler).not.toHaveBeenCalled();
    expect(xterm.reached).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing while disabled, and resumes when enabled", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ on }) => usePanelShortcut("KeyC", handler, on), {
      initialProps: { on: false },
    });
    const init = { key: "C", code: "KeyC", altKey: true, shiftKey: true };

    press(xterm.textarea, init);
    expect(handler).not.toHaveBeenCalled();
    expect(xterm.reached).toHaveBeenCalledTimes(1);

    rerender({ on: true });
    press(xterm.textarea, init);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls the latest handler and stops listening on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ h }) => usePanelShortcut("KeyF", h), {
      initialProps: { h: first },
    });
    const init = { key: "F", code: "KeyF", altKey: true, shiftKey: true };

    rerender({ h: second });
    press(xterm.textarea, init);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    press(xterm.textarea, init);
    expect(second).toHaveBeenCalledTimes(1);
    expect(xterm.reached).toHaveBeenCalledTimes(1);
  });
});
