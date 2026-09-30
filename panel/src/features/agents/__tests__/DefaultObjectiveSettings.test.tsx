import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AgentSettings from "../AgentSettings";
import { DefaultObjectiveSettings } from "../DefaultObjectiveSettings";
import { DEFAULT_TASK_PROMPT, preferences } from "../../../preferences/declarations";
import { readOverridable } from "../../../preferences/overridable";
import { readPreference, writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** Portable: the workspace document holds it, never browser storage. */
const KEY = storageKey(preferences.taskPromptDefault);

/** The shipped template, written out rather than referenced, so a read that
 * returns the constant by identity cannot pass for one that returns the text. */
const SHIPPED =
  "pavilio-execute-plan Implement all tasks in {path}; done when every task is checked and tests + lint pass.";

/** `vi.restoreAllMocks()` in test-setup does not undo `vi.stubGlobal`. */
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

function field(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Default objective" }) as HTMLTextAreaElement;
}

describe("DefaultObjectiveSettings", () => {
  it("the shipped objective names the skill and no loop command", () => {
    expect(DEFAULT_TASK_PROMPT).toBe(SHIPPED);
    expect(DEFAULT_TASK_PROMPT.startsWith("pavilio-execute-plan ")).toBe(true);
    // The loop command and the quoting belong to the launcher's run loop.
    expect(DEFAULT_TASK_PROMPT).not.toContain("/goal");
    expect(DEFAULT_TASK_PROMPT).not.toMatch(/^["']|["']$/);
    expect(readPreference(preferences.taskPromptDefault)).toBe(SHIPPED);
  });

  it("Settings shows the default objective under the launchers", async () => {
    stubEmptyAgentSettingsApi();
    writePreference(preferences.taskPromptDefault, "Only {change} in {project}.");

    render(<AgentSettings />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();

    const objective = field();
    expect(objective.value).toBe("Only {change} in {project}.");
    // Under the launchers: the last launcher control precedes the field.
    const addLauncher = screen.getByTestId("launcher-add");
    expect(
      addLauncher.compareDocumentPosition(objective) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The help names every placeholder and where a project overrides it.
    const help = screen.getByTestId("default-objective-help");
    expect(help.textContent).toContain("{change}");
    expect(help.textContent).toContain("{path}");
    expect(help.textContent).toContain("{project}");
    expect(help.textContent).toMatch(/Plans banner/);
  });

  it("editing it changes what un-overridden projects resolve", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptOverride, "Own {change}.", "beta");
    render(<DefaultObjectiveSettings />);

    expect(field().value).toBe(SHIPPED);
    await user.clear(field());
    await user.type(field(), "Ship {{change}");
    await user.tab();

    expect(globals.__PAVILIO_PREFS__![KEY]).toBe("Ship {change}");
    expect(
      readOverridable(preferences.taskPromptDefault, preferences.taskPromptOverride, "alpha"),
    ).toBe("Ship {change}");
    // A project with its own objective keeps it.
    expect(
      readOverridable(preferences.taskPromptDefault, preferences.taskPromptOverride, "beta"),
    ).toBe("Own {change}.");
  });

  it("emptying it restores the shipped objective", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, "Custom {path}.");
    render(<DefaultObjectiveSettings />);

    expect(field().value).toBe("Custom {path}.");
    await user.clear(field());
    await user.tab();

    // Cleared, not stored as "" and not stored as the shipped text.
    expect(KEY in globals.__PAVILIO_PREFS__!).toBe(false);
    expect(readPreference(preferences.taskPromptDefault)).toBe(SHIPPED);
    expect(field().value).toBe(SHIPPED);
  });

  it("an unchanged blur writes nothing", async () => {
    const user = userEvent.setup();
    render(<DefaultObjectiveSettings />);

    await user.click(field());
    await user.tab();

    expect(KEY in globals.__PAVILIO_PREFS__!).toBe(false);
  });

  describe("a write from elsewhere", () => {
    it("does not clobber an edit in progress", async () => {
      const user = userEvent.setup();
      writePreference(preferences.taskPromptDefault, "Stored {path}.");
      render(<DefaultObjectiveSettings />);

      await user.click(field());
      await user.type(field(), " Mine");
      act(() => writePreference(preferences.taskPromptDefault, "Other tab {change}."));

      // The focused, edited field keeps the user's text…
      expect(field().value).toBe("Stored {path}. Mine");
      // …and leaving it saves that text as the last word.
      await user.tab();
      expect(globals.__PAVILIO_PREFS__![KEY]).toBe("Stored {path}. Mine");
      expect(field().value).toBe("Stored {path}. Mine");
    });

    it("a focused field with no edit follows it, and so does an unfocused one", async () => {
      const user = userEvent.setup();
      writePreference(preferences.taskPromptDefault, "Stored {path}.");
      render(<DefaultObjectiveSettings />);

      act(() => writePreference(preferences.taskPromptDefault, "First {change}."));
      expect(field().value).toBe("First {change}.");

      await user.click(field());
      act(() => writePreference(preferences.taskPromptDefault, "Second {change}."));
      expect(field().value).toBe("Second {change}.");
      await user.tab();
      expect(globals.__PAVILIO_PREFS__![KEY]).toBe("Second {change}.");
    });
  });
});
