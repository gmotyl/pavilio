import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useTerminalFullscreen } from "../useTerminalFullscreen";
import { TerminalFullscreenLayer } from "../TerminalFullscreenLayer";
import { useFullscreenLayerActive } from "../../shell/Layout/fullscreenLayer";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ["/project/vector/iterm"] }, children);

/** The hook, the shell's hold as the layer takes it, and a navigation. */
function useProbe() {
  const fullscreen = useTerminalFullscreen();
  return { fullscreen, navigate: useNavigate(), chromeCovered: useFullscreenLayerActive() };
}

function renderProbe() {
  return renderHook(() => useProbe(), {
    wrapper: ({ children }) =>
      wrapper({
        children: createElement(Layer, null, children),
      }),
  });
}

// The layer is what holds the chrome, so the probe renders one fed by the hook
// state it reports through `layerOpen`.
let layerOpen = false;
function Layer({ children }: { children: ReactNode }) {
  return createElement(TerminalFullscreenLayer, { open: layerOpen, kind: "terminal", children });
}

describe("useTerminalFullscreen", () => {
  it("layer closes on exit and on route change", () => {
    const prefsBefore = JSON.stringify(
      (globalThis as { __PAVILIO_PREFS__?: unknown }).__PAVILIO_PREFS__ ?? {},
    );
    const storageBefore = localStorage.length;
    const { result, rerender, unmount } = renderProbe();
    const sync = () => {
      layerOpen = result.current.fullscreen.state.kind !== "closed";
      rerender();
    };
    expect(result.current.fullscreen.state).toEqual({ kind: "closed" });

    // Open the terminal layer: the chrome is covered.
    act(() => result.current.fullscreen.toggleTerminal());
    sync();
    expect(result.current.fullscreen.state).toEqual({ kind: "terminal" });
    expect(result.current.chromeCovered).toBe(true);

    // The exit control is the same toggle.
    act(() => result.current.fullscreen.toggleTerminal());
    sync();
    expect(result.current.fullscreen.state).toEqual({ kind: "closed" });
    expect(result.current.chromeCovered).toBe(false);

    // A cell layer toggles per cell: another cell's control switches to it,
    // its own closes it.
    act(() => result.current.fullscreen.toggleCell("a"));
    act(() => result.current.fullscreen.toggleCell("b"));
    expect(result.current.fullscreen.state).toEqual({ kind: "cell", sessionId: "b" });
    act(() => result.current.fullscreen.toggleCell("b"));
    expect(result.current.fullscreen.state).toEqual({ kind: "closed" });

    // A route change closes an open layer and releases the chrome.
    act(() => result.current.fullscreen.toggleCell("a"));
    sync();
    expect(result.current.chromeCovered).toBe(true);
    act(() => result.current.navigate("/project/other/iterm"));
    sync();
    expect(result.current.fullscreen.state).toEqual({ kind: "closed" });
    expect(result.current.chromeCovered).toBe(false);

    // Unmounting with a layer open releases the hold too.
    act(() => result.current.fullscreen.toggleTerminal());
    sync();
    expect(result.current.chromeCovered).toBe(true);
    unmount();
    layerOpen = false;
    const after = renderProbe();
    expect(after.result.current.chromeCovered).toBe(false);
    expect(after.result.current.fullscreen.state).toEqual({ kind: "closed" });
    after.unmount();

    // Nothing was persisted anywhere.
    expect(
      JSON.stringify((globalThis as { __PAVILIO_PREFS__?: unknown }).__PAVILIO_PREFS__ ?? {}),
    ).toBe(prefsBefore);
    expect(localStorage.length).toBe(storageBefore);
  });
});
