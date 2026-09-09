import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTerminalSessions,
  TERMINAL_FOCUS_EVENT,
  type TerminalFocusEventDetail,
} from "../useTerminalSessions";

const session = (id: string, name: string, project = "pavilio") => ({
  id,
  name,
  project,
  cwd: "/tmp",
  pid: 1,
  createdAt: new Date().toISOString(),
});

const SESSIONS = [session("a1", "pavilio-grid"), session("b2", "pavilio-tailscale")];

function mockSessions(list = SESSIONS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => list })),
  );
}

const focusKey = "panel-terminal-focus-pavilio";

beforeEach(() => {
  localStorage.clear();
  mockSessions();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTerminalSessions — focus the session actually on screen", () => {
  it("adopts the first session when nothing is stored", async () => {
    const { result } = renderHook(() => useTerminalSessions("pavilio"));
    await waitFor(() => expect(result.current.focusedId).toBe("a1"));
    expect(localStorage.getItem(focusKey)).toBe("a1");
  });

  it("adopts a session when the stored id names one that is gone", async () => {
    // A closed terminal, or a panel restart that handed out new ids.
    localStorage.setItem(focusKey, "stale-id-from-a-previous-run");
    const { result } = renderHook(() => useTerminalSessions("pavilio"));
    await waitFor(() => expect(result.current.focusedId).toBe("a1"));
    expect(localStorage.getItem(focusKey)).toBe("a1");
  });

  it("leaves a stored focus alone when it still names a live session", async () => {
    localStorage.setItem(focusKey, "b2");
    const { result } = renderHook(() => useTerminalSessions("pavilio"));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(result.current.focusedId).toBe("b2");
    expect(localStorage.getItem(focusKey)).toBe("b2");
  });

  it("broadcasts the adopted focus so the sidebar can follow", async () => {
    const seen: TerminalFocusEventDetail[] = [];
    const onFocus = (e: Event) =>
      seen.push((e as CustomEvent<TerminalFocusEventDetail>).detail);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    try {
      renderHook(() => useTerminalSessions("pavilio"));
      await waitFor(() => expect(seen).toContainEqual({ project: "pavilio", sessionId: "a1" }));
    } finally {
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    }
  });

  it("stays unfocused while the project has no sessions", async () => {
    mockSessions([]);
    const { result } = renderHook(() => useTerminalSessions("pavilio"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.focusedId).toBeNull();
    expect(localStorage.getItem(focusKey)).toBeNull();
  });
});
