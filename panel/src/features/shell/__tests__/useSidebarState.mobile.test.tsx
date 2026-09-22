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
    // COLLAPSED, and the seed is load-bearing. `setExpanded` below asks for
    // `true`, and the store's desktop path is an idempotent updater: seeded
    // `true` it would return its own argument and write nothing, so a leaked
    // desktop write would look exactly like the mobile no-op this asserts.
    // Seeded `false`, the leak has something to change and the spy sees it.
    seed(preferences.leftSidebarExpanded, false);
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

  it("returning to mobile starts closed again", () => {
    // The cross RESETS the fold, and desktop is the only leg that hides a
    // stale one: there `expanded` is the stored value and ignores the fold
    // entirely. So the reset is observable only on the way BACK, and a suite
    // that crosses once can never see it.
    const mm = installMatchMedia(true);
    // The desktop chose EXPANDED, so the middle leg is unambiguously the
    // stored value and the last leg is unambiguously the reset.
    seed(preferences.leftSidebarExpanded, true);
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);

    mm.setMobile(false);
    expect(result.current.expanded).toBe(true);

    // Back on the phone: the fold the user opened before the rotation is gone,
    // not carried over as an overlay they never asked for twice.
    mm.setMobile(true);
    expect(result.current.expanded).toBe(false);
  });

  it("two consumers of the same sidebar share the mobile fold", () => {
    // Why the fold is module state and not `useState`, pinned. `Layout` and
    // `TerminalDrawer` both hold the LEFT sidebar: one renders it, the other
    // decides how much room to leave for it. Per-hook state lets those two
    // disagree, and the sidebar is then open for one and closed for the other.
    installMatchMedia(true);
    const layout = renderHook(() => useSidebarState("leftSidebar"));
    const drawer = renderHook(() => useSidebarState("leftSidebar"));
    expect(drawer.result.current.expanded).toBe(false);

    act(() => layout.result.current.toggle());

    expect(layout.result.current.expanded).toBe(true);
    expect(drawer.result.current.expanded).toBe(true);

    // Shared per SIDE, though — the store is keyed, not global.
    const right = renderHook(() => useSidebarState("rightSidebar"));
    expect(right.result.current.expanded).toBe(false);

    // And it still closes for both, so the sharing is the live value rather
    // than a one-off read at mount.
    act(() => drawer.result.current.toggle());
    expect(layout.result.current.expanded).toBe(false);
    expect(drawer.result.current.expanded).toBe(false);
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
