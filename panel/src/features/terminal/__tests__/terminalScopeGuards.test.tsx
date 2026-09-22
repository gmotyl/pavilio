import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The blank-scope guards in `features/terminal`, spelt the way the rest of this
 * change spells them: `typeof x === "string" && x.trim() !== ""`, never a bare
 * `.trim()`.
 *
 * Every parameter below is typed `string`, so on paper none of this can happen.
 * It has happened twice already in this change, both times from the same place:
 * a route param reaches these call sites through a `name ?? ""` / `projectName`
 * chain that TypeScript sees as `string` while the value at runtime is
 * `undefined`. Once it crashed a render (`GitBranchDiff`), once it silently
 * emptied a result list (`useRepoSearch`). A bare `.trim()` on `undefined`
 * throws a TypeError; the guarded form falls through to the declared default
 * and writes nothing, which is what a scope nobody resolved should do.
 *
 * There is no live bug at these four sites today — that is the point of fixing
 * them now rather than after the third one.
 */

vi.mock("../TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) => <div data-testid={`tv-${sessionId}`} />,
  TerminalView: ({ sessionId }: { sessionId: string }) => <div data-testid={`tv-${sessionId}`} />,
}));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span />,
}));

import { orderProjectSessions } from "../QuickTerminalModal";
import { useTerminalMaximized } from "../useTerminalMaximized";
import { useTerminalOrdering } from "../useTerminalOrdering";
import { readTerminalFocus, writeTerminalFocus, type SessionMeta } from "../useTerminalSessions";
import { preferences } from "../../../preferences/declarations";

/** A scope that is `string` to the compiler and `undefined` at runtime. */
const UNRESOLVED = undefined as unknown as string;

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };

/**
 * The injected workspace document. A guard on a PORTABLE declaration has to be
 * checked HERE and not in `localStorage`, which such a write never touches.
 */
function prefsDoc(): Record<string, unknown> {
  return (globalThis as unknown as PrefGlobals).__PAVILIO_PREFS__ ?? {};
}

function session(id: string, project: string): SessionMeta {
  return { id, name: id, project, cwd: "/tmp", pid: 1, createdAt: "2026-01-01T00:00:00.000Z" };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as unknown as PrefGlobals).__PAVILIO_PREFS__ = { version: 1 };
});

describe("an unresolved scope does not throw", () => {
  it("writeTerminalFocus drops the write instead of throwing", () => {
    expect(() => writeTerminalFocus(UNRESOLVED, "sess-7f3a91c4")).not.toThrow();
    // Dropped, not misfiled: nothing was written under any key at all.
    expect(localStorage.length).toBe(0);
    expect(readTerminalFocus(UNRESOLVED)).toBe(preferences.terminalFocus.default);
  });

  it("useTerminalMaximized reads the declared default and writes nothing", () => {
    const { result } = renderHook(() => useTerminalMaximized(UNRESOLVED));

    expect(result.current[0]).toBe(preferences.terminalMaximized.default);
    // The setter is the second guard in that file, on the write side.
    expect(() => result.current[2](true)).not.toThrow();
    // Asserted on the DOCUMENT, not on `localStorage`.
    // `terminal.maximized` is `portable: true`, so a leaked write lands in
    // `window.__PAVILIO_PREFS__` and never on this machine — the
    // `localStorage.length` assertion that used to stand here could not fail,
    // and the test bit only through `.not.toThrow()`. Removing the write-side
    // guard outright left all four cases in this file green.
    //
    // The other three cases are `portable: false` and correctly targeted at
    // `localStorage`; only this one was pointed at the wrong store.
    expect(Object.keys(prefsDoc())).toEqual(["version"]);
  });

  it("useTerminalOrdering reads the declared defaults and writes nothing", () => {
    const sessions = [session("sess-7f3a91c4", "pavilio")];
    const { result } = renderHook(() => useTerminalOrdering(UNRESOLVED, sessions));

    expect(result.current.sessionOrder).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("orderProjectSessions falls back to the declared default order", () => {
    // A session whose own `project` is unresolved: without one, the filter
    // matches nothing and returns before the guard is ever reached.
    const sessions = [session("sess-7f3a91c4", UNRESOLVED), session("sess-0b2e55d1", "pavilio")];

    expect(() => orderProjectSessions(sessions, UNRESOLVED)).not.toThrow();
    expect(orderProjectSessions(sessions, UNRESOLVED).map((s) => s.id)).toEqual([
      "sess-7f3a91c4",
    ]);
  });
});
