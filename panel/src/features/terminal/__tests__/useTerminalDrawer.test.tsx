import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
  TerminalDrawerProvider,
  useTerminalDrawer,
} from "../useTerminalDrawer";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";
import { MOBILE_QUERY } from "../../../lib/breakpoints";

/**
 * Every write that reached the preference store, so "a phone never wrote the
 * open intent" can be asserted on the WRITE itself rather than on the value
 * that happens to be sitting there afterwards. Reading the value back proves
 * only that nothing wrote a DIFFERENT value; an implementation that wrote the
 * value it already held would pass such a test and still broadcast a change to
 * every other tab on this workspace.
 *
 * The factory is hoisted above the imports, so the array it closes over has to
 * be hoisted with it.
 */
const { writes } = vi.hoisted(() => ({
  writes: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    writePreference: <T,>(
      def: Parameters<typeof actual.writePreference<T>>[0],
      value: T,
      scopeArg?: string,
    ) => {
      writes.push({ key: def.key, value });
      actual.writePreference(def, value, scopeArg);
    },
  };
});

/** The writes the drawer's open intent received, by the key the store uses. */
const openWrites = () =>
  writes.filter((w) => w.key === preferences.terminalDrawerOpen.key);

/**
 * The drawer's open intent, width and side are PORTABLE: the shape of the
 * panel is a choice, not a fact about this machine, so all three live in the
 * workspace document rather than in browser storage.
 */
const setOpenPref = (v: boolean) => writePreference(preferences.terminalDrawerOpen, v);
const setWidthPref = (v: number) => writePreference(preferences.terminalDrawerWidth, v);
const setSidePref = (v: "left" | "right") =>
  writePreference(preferences.terminalDrawerSide, v);
const openPref = () => readPreference(preferences.terminalDrawerOpen);
const widthPref = () => readPreference(preferences.terminalDrawerWidth);
const sidePref = () => readPreference(preferences.terminalDrawerSide);
/** A value no codec accepts, written straight into the document. */
const setRawSide = (raw: string) => {
  (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__![
    storageKey(preferences.terminalDrawerSide)
  ] = raw;
};


function Probe() {
  const {
    open,
    visible,
    suppressed,
    overlayActive,
    setOverlayActive,
    width,
    maxWidth,
    setWidth,
    side,
    setSide,
  } = useTerminalDrawer();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="visible">{String(visible)}</span>
      <span data-testid="suppressed">{String(suppressed)}</span>
      <span data-testid="overlay-active">{String(overlayActive)}</span>
      <button data-testid="overlay-on" onClick={() => setOverlayActive(true)}>
        overlay on
      </button>
      <button data-testid="overlay-off" onClick={() => setOverlayActive(false)}>
        overlay off
      </button>
      <span data-testid="width">{width}</span>
      <span data-testid="max">{maxWidth}</span>
      <button data-testid="grow" onClick={() => setWidth(5000)}>
        grow
      </button>
      <span data-testid="side">{side}</span>
      <button data-testid="dock-left" onClick={() => setSide("left")}>
        left
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

/**
 * A controllable `matchMedia`, the shape the resizable-row and sidebar suites
 * use. jsdom's own — where it has one at all — answers a fixed viewport and
 * dispatches no `change`, so the widening half of this feature could not be
 * driven through it.
 */
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
    // The deprecated pair, feeding the same listener set. `useIsMobile` reaches
    // only for the modern one today, but a stub that omits these answers
    // `undefined` to a caller that uses the legacy form — a silent no-op rather
    // than a failure, which is exactly the shape of bug a stub should not be
    // able to hide.
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) =>
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

/** Whatever this environment had before a test installed the stub. */
const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function restoreMatchMedia() {
  if (nativeMatchMedia) Object.defineProperty(window, "matchMedia", nativeMatchMedia);
  else delete (window as { matchMedia?: unknown }).matchMedia;
}

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
  beforeEach(() => {
    localStorage.clear();
    writes.length = 0;
  });

  // runs even if a test throws mid-body, so neither a viewport override nor a
  // media-query stub can leak into the next test
  afterEach(() => {
    setViewport(JSDOM_VIEWPORT);
    restoreMatchMedia();
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
    setOpenPref(true);
    setWidthPref(540);
    setup("/project/vector/memo");
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(screen.getByTestId("width")).toHaveTextContent("540");
  });

  it("keeps the open intent when navigating to the iterm tab, and restores it on the way back", () => {
    setOpenPref(true);
    setup("/project/vector/memo");
    expect(screen.getByTestId("visible")).toHaveTextContent("true");

    act(() => {
      fireEvent.click(screen.getByTestId("to-iterm"));
    });
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
    expect(screen.getByTestId("visible")).toHaveTextContent("false");
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(openPref()).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("to-memo"));
    });
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
  });

  it("keeps the open intent when navigating to a non-project route", () => {
    setOpenPref(true);
    setup("/project/vector/memo");

    act(() => {
      fireEvent.click(screen.getByTestId("to-settings"));
    });
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
    expect(screen.getByTestId("visible")).toHaveTextContent("false");
    expect(openPref()).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("to-memo"));
    });
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
  });

  it("makes Cmd+B a no-op while suppressed, leaving the stored intent alone", () => {
    setOpenPref(true);
    setup("/project/vector/iterm");
    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(openPref()).toBe(true);
  });

  it("lets an overlay suppress visibility without touching the stored open intent", () => {
    setOpenPref(true);
    setup("/project/vector/memo");
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
    expect(screen.getByTestId("overlay-active")).toHaveTextContent("false");

    act(() => {
      fireEvent.click(screen.getByTestId("overlay-on"));
    });
    expect(screen.getByTestId("overlay-active")).toHaveTextContent("true");
    expect(screen.getByTestId("visible")).toHaveTextContent("false");
    // intent untouched, in memory and on disk
    expect(screen.getByTestId("open")).toHaveTextContent("true");
    expect(openPref()).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("overlay-off"));
    });
    expect(screen.getByTestId("visible")).toHaveTextContent("true");
  });

  it("never persists overlayActive", () => {
    setup("/project/vector/memo");
    act(() => {
      fireEvent.click(screen.getByTestId("overlay-on"));
    });
    // Nowhere at all: not in the workspace document, and not in browser
    // storage either — the drawer writes nothing to the latter any more.
    const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
      .__PAVILIO_PREFS__!;
    expect(Object.keys(doc).some((k) => k.toLowerCase().includes("overlay"))).toBe(false);
    expect(localStorage.length).toBe(0);
    // and a fresh mount starts with no overlay
    cleanup();
    setup("/project/vector/memo");
    expect(screen.getByTestId("overlay-active")).toHaveTextContent("false");
  });

  it("caps width at viewport minus the main-content floor, not a fixed 900", () => {
    setup("/project/vector/memo");
    // jsdom viewport is 1024 wide → 1024 - 360 = 664
    expect(screen.getByTestId("max")).toHaveTextContent("664");
    act(() => {
      fireEvent.click(screen.getByTestId("grow"));
    });
    expect(screen.getByTestId("width")).toHaveTextContent("664");
    expect(widthPref()).toBe(664);
  });

  it("re-clamps the effective width when the window shrinks, without rewriting the stored value", () => {
    setWidthPref(640);
    setup("/project/vector/memo");
    expect(screen.getByTestId("width")).toHaveTextContent("640");

    act(() => {
      setViewport(800);
      fireEvent(window, new Event("resize"));
    });

    // 800 - 360 = 440
    expect(screen.getByTestId("width")).toHaveTextContent("440");
    expect(screen.getByTestId("max")).toHaveTextContent("440");
    expect(widthPref()).toBe(640);

    // regrowing the viewport restores the full stored preference
    act(() => {
      setViewport(JSDOM_VIEWPORT);
      fireEvent(window, new Event("resize"));
    });
    expect(screen.getByTestId("width")).toHaveTextContent("640");
  });

  it("defaults the drawer to the left", () => {
    setup("/project/vector/memo");
    expect(screen.getByTestId("side")).toHaveTextContent("left");
  });

  it("keeps a stored right-side preference", () => {
    // A stored value is only ever written by an explicit drag, so a browser
    // that already docks right keeps docking right — the default flip must
    // not override a choice the user made.
    setSidePref("right");
    setup("/project/vector/memo");
    expect(screen.getByTestId("side")).toHaveTextContent("right");
  });

  it("persists the dock side and restores it", () => {
    setup("/project/vector/memo");
    act(() => {
      fireEvent.click(screen.getByTestId("dock-left"));
    });
    expect(screen.getByTestId("side")).toHaveTextContent("left");
    expect(sidePref()).toBe("left");
  });

  it("falls back to the default for an unrecognised stored side", () => {
    setRawSide("top");
    setup("/project/vector/memo");
    expect(screen.getByTestId("side")).toHaveTextContent("left");
  });
  /**
   * A phone has a terminal tab of its own and no room to share the screen, so
   * the drawer stands down there. The suppression is derived from the viewport
   * every render and is never written back: the stored open/closed value is the
   * same person's desktop choice, and a visit from a phone that closed it would
   * silently close the drawer on their laptop too.
   */
  describe("on a narrow viewport", () => {
    it("does not render the drawer on a narrow viewport", () => {
      setOpenPref(true);
      installMatchMedia(true);
      setup("/project/vector/memo");

      expect(screen.getByTestId("visible")).toHaveTextContent("false");
      // The route still hosts the drawer perfectly well — this is a fact about
      // the viewport, and it must not be smuggled into the route's own term.
      expect(screen.getByTestId("suppressed")).toHaveTextContent("false");
      expect(screen.getByTestId("open")).toHaveTextContent("true");
    });

    it("leaves the stored open choice untouched while suppressed", () => {
      // First, prove the spy is live: a path that MUST write the open intent,
      // driven on a desktop viewport. Without this the silence asserted below
      // would be indistinguishable from a spy that is never reached at all.
      installMatchMedia(false);
      setup("/project/vector/memo");
      act(() => {
        fireEvent.keyDown(window, { key: "b", metaKey: true });
      });
      expect(openWrites()).toEqual([
        { key: preferences.terminalDrawerOpen.key, value: true },
      ]);

      cleanup();
      writes.length = 0;

      // Now the phone. Nothing it does may reach that key.
      setOpenPref(true);
      writes.length = 0;
      installMatchMedia(true);
      setup("/project/vector/memo");
      expect(screen.getByTestId("visible")).toHaveTextContent("false");

      expect(openWrites()).toEqual([]);
      expect(openPref()).toBe(true);
    });

    it("renders again when the viewport widens", () => {
      setOpenPref(true);
      const media = installMatchMedia(true);
      setup("/project/vector/memo");
      expect(screen.getByTestId("visible")).toHaveTextContent("false");
      writes.length = 0;

      media.setMobile(false);

      expect(screen.getByTestId("visible")).toHaveTextContent("true");
      // Restored from the stored intent, which the phone never touched — so
      // the widening needed no write of its own either.
      expect(openWrites()).toEqual([]);
      expect(openPref()).toBe(true);
    });

    it("is unchanged on a desktop viewport", () => {
      setOpenPref(true);
      installMatchMedia(false);
      setup("/project/vector/memo");
      expect(screen.getByTestId("visible")).toHaveTextContent("true");

      // still governed by the route
      act(() => {
        fireEvent.click(screen.getByTestId("to-iterm"));
      });
      expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
      expect(screen.getByTestId("visible")).toHaveTextContent("false");
      act(() => {
        fireEvent.click(screen.getByTestId("to-memo"));
      });
      expect(screen.getByTestId("visible")).toHaveTextContent("true");

      // and still by a conflicting overlay
      act(() => {
        fireEvent.click(screen.getByTestId("overlay-on"));
      });
      expect(screen.getByTestId("visible")).toHaveTextContent("false");
      act(() => {
        fireEvent.click(screen.getByTestId("overlay-off"));
      });
      expect(screen.getByTestId("visible")).toHaveTextContent("true");

      // and still by the stored intent
      act(() => {
        fireEvent.keyDown(window, { key: "b", metaKey: true });
      });
      expect(screen.getByTestId("open")).toHaveTextContent("false");
      expect(screen.getByTestId("visible")).toHaveTextContent("false");
    });
  });
});
