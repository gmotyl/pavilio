import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ShortcutSettings } from "../ShortcutSettings";
import AgentSettings from "../AgentSettings";
import {
  DEFAULT_COMPOSER_SHORTCUTS,
  preferences,
  type ComposerShortcut,
} from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** Portable: the workspace document holds it, never browser storage. */
const KEY = storageKey(preferences.composerShortcuts);

/** The shipped list, written out rather than referenced, so a read that returns
 * the constant by identity cannot pass for one that returns the entries. */
const SHIPPED: ComposerShortcut[] = [
  { label: "Yes", text: "yes" },
  { label: "OK", text: "ok" },
];

/** `vi.restoreAllMocks()` in test-setup does not undo `vi.stubGlobal`. */
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A real read-back through the store, never the component's own state. */
function stored(): ComposerShortcut[] {
  return readPreference(preferences.composerShortcuts);
}

function labelFields(): HTMLInputElement[] {
  return screen.getAllByRole("textbox", { name: /^Shortcut \d+ label$/ }) as HTMLInputElement[];
}

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

describe("ShortcutSettings", () => {
  it("the shipped shortcuts are Yes and OK", () => {
    expect(globals.__PAVILIO_PREFS__![KEY]).toBeUndefined();
    expect(stored()).toEqual(SHIPPED);
    expect(DEFAULT_COMPOSER_SHORTCUTS).toEqual(SHIPPED);

    render(<ShortcutSettings />);
    expect(labelFields().map((f) => f.value)).toEqual(["Yes", "OK"]);
    expect(
      (screen.getAllByRole("textbox", { name: /^Shortcut \d+ text$/ }) as HTMLInputElement[]).map(
        (f) => f.value,
      ),
    ).toEqual(["yes", "ok"]);
  });

  it("Settings adds, edits and removes a shortcut in order", async () => {
    const user = userEvent.setup();
    render(<ShortcutSettings />);

    // Add: appended at the end, trimmed.
    await user.type(screen.getByTestId("shortcut-new-label"), " Go on ");
    await user.type(screen.getByTestId("shortcut-new-text"), "continue");
    await user.click(screen.getByTestId("shortcut-add"));
    const afterAdd = stored();
    expect(afterAdd).toEqual([...SHIPPED, { label: "Go on", text: "continue" }]);
    expect(afterAdd).not.toBe(DEFAULT_COMPOSER_SHORTCUTS);
    expect((screen.getByTestId("shortcut-new-label") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("shortcut-new-text") as HTMLInputElement).value).toBe("");

    // Edit: blur commits the row, in place.
    const okLabel = screen.getByTestId("shortcut-label-1");
    await user.clear(okLabel);
    await user.type(okLabel, "Okay");
    await user.tab();
    const afterEdit = stored();
    expect(afterEdit).toEqual([
      { label: "Yes", text: "yes" },
      { label: "Okay", text: "ok" },
      { label: "Go on", text: "continue" },
    ]);
    expect(afterEdit).not.toBe(afterAdd);

    // Remove: the rest keep their order.
    await user.click(screen.getByTestId("shortcut-remove-0"));
    const afterRemove = stored();
    expect(afterRemove).toEqual([
      { label: "Okay", text: "ok" },
      { label: "Go on", text: "continue" },
    ]);
    expect(afterRemove).not.toBe(afterEdit);
    expect(labelFields().map((f) => f.value)).toEqual(["Okay", "Go on"]);

    // The shipped default was never mutated along the way.
    expect(DEFAULT_COMPOSER_SHORTCUTS).toEqual(SHIPPED);
  });

  it("a shortcut needs a label and a text", async () => {
    const user = userEvent.setup();
    render(<ShortcutSettings />);

    // A blank label is not added.
    await user.type(screen.getByTestId("shortcut-new-text"), "continue");
    await user.click(screen.getByTestId("shortcut-add"));
    expect(globals.__PAVILIO_PREFS__![KEY]).toBeUndefined();

    // Nor is a whitespace-only text.
    await user.clear(screen.getByTestId("shortcut-new-text"));
    await user.type(screen.getByTestId("shortcut-new-label"), "Go on");
    await user.type(screen.getByTestId("shortcut-new-text"), "   ");
    await user.click(screen.getByTestId("shortcut-add"));
    expect(globals.__PAVILIO_PREFS__![KEY]).toBeUndefined();

    // An edit that blanks a half is rejected and the field shows the stored value.
    const yesText = screen.getByTestId("shortcut-text-0") as HTMLInputElement;
    await user.clear(yesText);
    await user.tab();
    expect(globals.__PAVILIO_PREFS__![KEY]).toBeUndefined();
    expect(yesText.value).toBe("yes");

    const okLabel = screen.getByTestId("shortcut-label-1") as HTMLInputElement;
    await user.clear(okLabel);
    await user.type(okLabel, "  ");
    await user.tab();
    expect(globals.__PAVILIO_PREFS__![KEY]).toBeUndefined();
    expect(okLabel.value).toBe("OK");
    expect(stored()).toEqual(SHIPPED);
  });

  it("the list is workspace-wide", async () => {
    stubEmptyAgentSettingsApi();
    const def = preferences.composerShortcuts;
    expect(def.key).toBe("composer.shortcuts");
    expect(def.scope).toBe("global");
    expect(def.portable).toBe(true);
    // Global: one key, no project suffix, so every project reads the same list.
    expect(KEY).toBe("composer.shortcuts");

    const list = [
      { label: "Go on", text: "continue" },
      { label: "Yes", text: "yes" },
    ];
    writePreference(def, list);
    expect(globals.__PAVILIO_PREFS__![KEY]).toEqual(list);
    expect(localStorage.length).toBe(0);
    expect(stored()).toEqual(list);

    // Settings shows it under its own heading, with help naming both halves.
    render(<AgentSettings />);
    expect(await screen.findByText("Composer shortcuts")).toBeTruthy();
    expect(labelFields().map((f) => f.value)).toEqual(["Go on", "Yes"]);
    const help = screen.getByTestId("shortcut-help");
    expect(help.textContent).toContain("chip");
    expect(help.textContent).toContain("Enter");
  });
});
