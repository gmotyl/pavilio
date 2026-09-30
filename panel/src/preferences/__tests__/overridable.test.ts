import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASK_PROMPT, preferences } from "../declarations";
import { clearOverride, readOverridable, writeOverride } from "../overridable";
import { __resetPreferenceStoreForTests, writePreference } from "../store";

/**
 * The first two-level preference: a workspace default (`plans.taskPrompt`,
 * global) and a per-project override (`plans.taskPrompt.override`, project
 * scoped), read as "the project's value if one is stored, else the default's".
 *
 * Driven through the real declarations rather than test-local ones, so the
 * shipped pair is what is pinned — including that the override really is
 * project-scoped and the default really is global.
 */
type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const base = preferences.taskPromptDefault;
const override = preferences.taskPromptOverride;

function doc(): Record<string, unknown> {
  const current = globals.__PAVILIO_PREFS__;
  if (!current) throw new Error("no injected preferences document");
  return current;
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
  );
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

describe("readOverridable", () => {
  it("a project with no override reads the workspace default", () => {
    writePreference(base, "Workspace objective for {change}");

    expect(readOverridable(base, override, "alpha")).toBe("Workspace objective for {change}");
  });

  it("an override applies to its project only", () => {
    writePreference(base, "Workspace objective");
    writeOverride(override, "Alpha's own objective", "alpha");

    expect(readOverridable(base, override, "alpha")).toBe("Alpha's own objective");
    expect(readOverridable(base, override, "beta")).toBe("Workspace objective");
  });

  it("reset clears the key rather than copying the default into it", () => {
    writePreference(base, "Workspace objective");
    writeOverride(override, "Alpha's own objective", "alpha");
    expect(doc()).toHaveProperty(["plans.taskPrompt.override@alpha"]);

    clearOverride(override, "alpha");

    // Absent, not holding the default's text: a copy would stop tracking it.
    expect(Object.keys(doc())).not.toContain("plans.taskPrompt.override@alpha");
    expect(readOverridable(base, override, "alpha")).toBe("Workspace objective");
  });

  it("a project that was reset tracks later edits to the default", () => {
    writePreference(base, "First default");
    writeOverride(override, "Alpha's own objective", "alpha");
    clearOverride(override, "alpha");

    writePreference(base, "Edited default");

    expect(readOverridable(base, override, "alpha")).toBe("Edited default");
  });

  it("an unwritten global falls back to the declared default", () => {
    expect(Object.keys(doc())).not.toContain("plans.taskPrompt");

    expect(readOverridable(base, override, "alpha")).toBe(DEFAULT_TASK_PROMPT);
    expect(base.default).toBe(DEFAULT_TASK_PROMPT);
    // The shipped objective carries no loop command and no quotes — those
    // belong to the launcher's run loop — and names the file it is about.
    expect(DEFAULT_TASK_PROMPT).not.toContain("/goal");
    expect(DEFAULT_TASK_PROMPT).not.toMatch(/["']/);
    expect(DEFAULT_TASK_PROMPT).toContain("{path}");
  });
});
