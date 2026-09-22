import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { useSidebarState } from "../useSidebarState";
import { preferences } from "../../../preferences/declarations";
import type { PreferenceDef } from "../../../preferences/types";

/**
 * A controllable `matchMedia`, the shape `useFileListSidebar`'s suite uses.
 * jsdom has none, so desktop is what a test gets by saying nothing — and the
 * point of this file is that the two viewports answer differently.
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

type Doc = Record<string, unknown>;
const prefsDoc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Doc }).__PAVILIO_PREFS__!;

/** A value already in the workspace file, as a previous desktop session left it. */
function seed(def: PreferenceDef<boolean>, value: boolean) {
  prefsDoc()[def.key] = value;
}

/**
 * Every key the store WRITES, collected as it writes it.
 *
 * Both declarations here are portable, so a write is `doc[key] = …` on the
 * injected `__PAVILIO_PREFS__` document — that object is the write path, and a
 * proxy around it sees every assignment the store makes through it. It is a
 * spy on the INSTANCE for the same reason the rest of this suite avoids
 * prototype spies: the object the store reaches for is the one installed on
 * `globalThis`, and nothing about these two preferences ever touches
 * `Storage.prototype` at all.
 *
 * Rendered state is not enough on its own — a sidebar can look closed while
 * the store has been told about it. "Toggling on desktop still persists" is
 * the control: it proves this spy is wired to a path that does fire.
 */
function spyPreferenceWrites(): string[] {
  const written: string[] = [];
  const doc = prefsDoc();
  (globalThis as { __PAVILIO_PREFS__?: Doc }).__PAVILIO_PREFS__ = new Proxy(
    doc,
    {
      set(target, key, value) {
        written.push(String(key));
        return Reflect.set(target, key, value);
      },
      deleteProperty(target, key) {
        written.push(String(key));
        return Reflect.deleteProperty(target, key);
      },
    },
  );
  return written;
}

describe("useSidebarState on a mobile viewport", () => {
  it("both sidebars start closed on a mobile viewport", () => {
    installMatchMedia(true);
    const left = renderHook(() => useSidebarState("leftSidebar"));
    const right = renderHook(() => useSidebarState("rightSidebar"));

    // Both declare `true`, and on a phone a sidebar that starts open is a
    // sidebar covering the page the user opened.
    expect(preferences.leftSidebarExpanded.default).toBe(true);
    expect(preferences.rightSidebarExpanded.default).toBe(true);
    expect(left.result.current.expanded).toBe(false);
    expect(right.result.current.expanded).toBe(false);
  });

  it("a stored expanded value does not open a sidebar on mobile", () => {
    installMatchMedia(true);
    // Not the default this time but a value someone's desktop wrote into the
    // workspace file — the preference is portable, so it arrives on the phone.
    seed(preferences.leftSidebarExpanded, true);
    const { result } = renderHook(() => useSidebarState("leftSidebar"));

    expect(result.current.expanded).toBe(false);
    // And the stored value is still there, unread rather than overwritten.
    expect(prefsDoc()[preferences.leftSidebarExpanded.key]).toBe(true);
  });

  it("toggling on mobile writes no preference", () => {
    installMatchMedia(true);
    seed(preferences.leftSidebarExpanded, true);
    const written = spyPreferenceWrites();
    const { result } = renderHook(() => useSidebarState("leftSidebar"));

    // It still opens — a transient sidebar is not a disabled one.
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    // `setExpanded` is the other way in, and the one the edge swipe uses.
    act(() => result.current.setExpanded(true));
    expect(result.current.expanded).toBe(true);

    expect(written).toEqual([]);
  });

  it("crossing back to desktop restores the stored value", () => {
    const mm = installMatchMedia(true);
    // The desktop chose COLLAPSED, so "restores the stored value" cannot be
    // confused with "went back to the default".
    seed(preferences.leftSidebarExpanded, false);
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    expect(result.current.expanded).toBe(false);

    // Opened on the phone, transiently.
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);

    mm.setMobile(false);
    expect(result.current.expanded).toBe(false);
  });

  it("toggling on desktop still persists", () => {
    installMatchMedia(false);
    const written = spyPreferenceWrites();
    const { result, unmount } = renderHook(() =>
      useSidebarState("rightSidebar"),
    );

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(written).toEqual([preferences.rightSidebarExpanded.key]);
    expect(prefsDoc()[preferences.rightSidebarExpanded.key]).toBe(false);
    unmount();

    // And it is still there for the next mount, which is the whole point of
    // persisting it.
    const { result: remounted } = renderHook(() =>
      useSidebarState("rightSidebar"),
    );
    expect(remounted.current.expanded).toBe(false);
  });
});
