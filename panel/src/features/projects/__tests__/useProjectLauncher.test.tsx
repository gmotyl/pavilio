import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useProjectLauncher } from "../useProjectLauncher";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** `shell` has no run loop, so it is never offered; the other three are ready. */
const LAUNCHERS: TerminalLauncher[] = [
  { name: "shell", command: "bash", runLoop: "" },
  { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
  { name: "codex", command: "codex", runLoop: "/goal {prompt}" },
  { name: "opencode", command: "opencode", runLoop: "{prompt}", promptFlag: "--prompt" },
];

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
  );
  writePreference(preferences.terminalLaunchers, LAUNCHERS);
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

describe("useProjectLauncher", () => {
  it("resolves the project pick by name", () => {
    writePreference(preferences.plansRunLauncher, "claude");
    writePreference(preferences.projectRunLauncher, "codex", "pavilio");

    const { result } = renderHook(() => useProjectLauncher("pavilio"));

    expect(result.current.launcher?.name).toBe("codex");
    expect(result.current.state?.kind).toBe("ready");
    expect(result.current.overridden).toBe(true);
    expect(result.current.offered.map((entry) => entry.name)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
  });

  it("falls back to the workspace plansRunLauncher when unset", () => {
    writePreference(preferences.plansRunLauncher, "opencode");

    const { result } = renderHook(() => useProjectLauncher("pavilio"));

    expect(result.current.launcher?.name).toBe("opencode");
    expect(result.current.overridden).toBe(false);
  });

  it("falls back to the first ready launcher when nothing resolves", () => {
    // The project pick names a launcher that is gone, the workspace one names a
    // launcher that is not offered (no run loop): neither resolves.
    // `aider` is offered but its run loop is a whole command line (not ready)
    // and sits AHEAD of the first ready one, so "first offered" would pick it.
    writePreference(preferences.terminalLaunchers, [
      LAUNCHERS[0],
      { name: "aider", command: "aider", runLoop: "aider --message {prompt}" },
      ...LAUNCHERS.slice(1),
    ]);
    writePreference(preferences.projectRunLauncher, "gone", "pavilio");
    writePreference(preferences.plansRunLauncher, "shell");

    const { result } = renderHook(() => useProjectLauncher("pavilio"));

    expect(result.current.offered[0]?.name).toBe("aider");
    expect(result.current.launcher?.name).toBe("claude");
    expect(result.current.state?.kind).toBe("ready");
    expect(result.current.overridden).toBe(false);
  });

  it("falls back to the first offered launcher when none is ready", () => {
    writePreference(preferences.terminalLaunchers, [
      LAUNCHERS[0],
      { name: "aider", command: "aider", runLoop: "aider --message {prompt}" },
      { name: "goose", command: "goose", runLoop: "goose run {prompt}" },
    ]);

    const { result } = renderHook(() => useProjectLauncher("pavilio"));

    expect(result.current.launcher?.name).toBe("aider");
    expect(result.current.state?.kind).toBe("wholeLine");
    expect(result.current.overridden).toBe(false);
  });

  it("resolves to null when no launcher is offered", () => {
    writePreference(preferences.terminalLaunchers, [LAUNCHERS[0]]);

    const { result } = renderHook(() => useProjectLauncher("pavilio"));

    expect(result.current.launcher).toBeNull();
    expect(result.current.state).toBeNull();
    expect(result.current.offered).toEqual([]);
  });

  it("keeps the pick across a reordered launcher list", () => {
    writePreference(preferences.projectRunLauncher, "codex", "pavilio");
    const { result } = renderHook(() => useProjectLauncher("pavilio"));
    expect(result.current.launcher?.name).toBe("codex");

    act(() => writePreference(preferences.terminalLaunchers, [...LAUNCHERS].reverse()));

    expect(result.current.launcher?.name).toBe("codex");
    expect(result.current.overridden).toBe(true);
  });

  it("setLauncher scopes the pick to one project", () => {
    writePreference(preferences.plansRunLauncher, "claude");
    const pavilio = renderHook(() => useProjectLauncher("pavilio"));
    const other = renderHook(() => useProjectLauncher("other"));

    act(() => pavilio.result.current.setLauncher("opencode"));

    expect(pavilio.result.current.launcher?.name).toBe("opencode");
    expect(pavilio.result.current.overridden).toBe(true);
    expect(readPreference(preferences.projectRunLauncher, "pavilio")).toBe("opencode");
    expect(other.result.current.launcher?.name).toBe("claude");
    expect(other.result.current.overridden).toBe(false);
    expect(readPreference(preferences.projectRunLauncher, "other")).toBeNull();
    expect(readPreference(preferences.plansRunLauncher)).toBe("claude");
  });
});
