import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LauncherSettings } from "../LauncherSettings";
import AgentSettings from "../AgentSettings";
import {
  DEFAULT_TERMINAL_LAUNCHERS,
  preferences,
  type TerminalLauncher,
} from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** Portable: the workspace document holds it, never browser storage. */
const KEY = storageKey(preferences.terminalLaunchers);

/** The three defaults, written out rather than referenced.
 *
 * `readPreference` hands `DEFAULT_TERMINAL_LAUNCHERS` back BY REFERENCE when
 * nothing is stored, so asserting a read against that constant would pass on
 * identity and prove nothing about what was — or was not — written. */
const DEFAULTS: TerminalLauncher[] = [
  { name: "claude", command: "claude" },
  { name: "codex", command: "codex" },
  { name: "opencode", command: "opencode" },
];

/**
 * `test-setup.ts` runs `vi.restoreAllMocks()`, which does NOT undo a
 * `vi.stubGlobal` — so without this the next test added to this file would
 * silently inherit a `fetch` that answers `[]` to everything.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A real read-back through the store, never the component's own state. */
function stored(): TerminalLauncher[] {
  return readPreference(preferences.terminalLaunchers);
}

/**
  * Every row's fields are named by their POSITION — "Launcher 2 command" — so a
  * screen reader user hears which row they are in. These read them by that
  * shape, in DOM order, which is the row order.
  */
function nameFields(): HTMLInputElement[] {
  return screen.getAllByRole("textbox", { name: /^Launcher \d+ name$/ }) as HTMLInputElement[];
}

function commandFields(): HTMLInputElement[] {
  return screen.getAllByRole("textbox", { name: /^Launcher \d+ command$/ }) as HTMLInputElement[];
}

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

describe("LauncherSettings", () => {
  it("lists a row per stored launcher", async () => {
    stubEmptyAgentSettingsApi();
    writePreference(preferences.terminalLaunchers, [
      { name: "claude", command: "claude" },
      { name: "resume", command: "claude --resume" },
    ]);

    render(<AgentSettings />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();

    // The editor sits on the same surface as the voice picker and the switch.
    const section = screen.getByRole("heading", { level: 2, name: "Speech" }).closest("section");
    expect(section).not.toBeNull();
    const scope = within(section!);
    expect(scope.getByRole("combobox", { name: "Speech voice" })).toBeInTheDocument();
    expect(
      scope.getByRole("checkbox", { name: "Open the answer pane on a new answer" }),
    ).toBeInTheDocument();

    // One row per stored entry, each carrying both fields and a remove control.
    const names = scope.getAllByRole("textbox", {
      name: /^Launcher \d+ name$/,
    }) as HTMLInputElement[];
    const commands = scope.getAllByRole("textbox", {
      name: /^Launcher \d+ command$/,
    }) as HTMLInputElement[];
    expect(names.map((field) => field.value)).toEqual(["claude", "resume"]);
    expect(commands.map((field) => field.value)).toEqual(["claude", "claude --resume"]);
    // The row number is in the name too: two launchers may legally share one,
    // and "Remove claude" twice over is a name that identifies nothing — and a
    // `getByRole` that throws.
    expect(scope.getByRole("button", { name: "Remove launcher 1: claude" })).toBeInTheDocument();
    expect(scope.getByRole("button", { name: "Remove launcher 2: resume" })).toBeInTheDocument();
  });

  it("appends an added launcher to the preference", async () => {
    const user = userEvent.setup();

    render(<LauncherSettings />);
    // Nothing stored, so the row shows the declared defaults.
    expect(nameFields().map((field) => field.value)).toEqual(["claude", "codex", "opencode"]);

    await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "resume");
    await user.type(
      screen.getByRole("textbox", { name: "New launcher command" }),
      "claude --resume",
    );
    await user.click(screen.getByRole("button", { name: "Add launcher" }));

    expect(stored()).toEqual([...DEFAULTS, { name: "resume", command: "claude --resume" }]);
    // Appended last, and the frozen defaults were not pushed onto in place.
    expect(stored().at(-1)).toEqual({ name: "resume", command: "claude --resume" });
    expect(DEFAULT_TERMINAL_LAUNCHERS).toEqual(DEFAULTS);
    expect(nameFields().map((field) => field.value)).toEqual([
      "claude",
      "codex",
      "opencode",
      "resume",
    ]);
    // The add form is empty again, so a second click cannot re-append.
    expect(screen.getByRole("textbox", { name: "New launcher name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "New launcher command" })).toHaveValue("");
  });

  it("removes a launcher and does not resurrect the defaults", async () => {
    const user = userEvent.setup();

    const view = render(<LauncherSettings />);
    await user.click(screen.getByRole("button", { name: "Remove launcher 2: codex" }));

    // Read back through the store, not off the component's state.
    expect(stored()).toEqual([
      { name: "claude", command: "claude" },
      { name: "opencode", command: "opencode" },
    ]);

    // The last two go as well. An emptied list is the trap: the declared
    // default is handed back only when NOTHING is stored, so a stored empty
    // list has to stay distinguishable from a workspace that never wrote one.
    // Each removal renumbers the rows under it, so these are rows 1 and 1.
    await user.click(screen.getByRole("button", { name: "Remove launcher 1: claude" }));
    await user.click(screen.getByRole("button", { name: "Remove launcher 1: opencode" }));

    expect(stored()).toEqual([]);
    // The document holds the emptied list — an absent key would read as the
    // three defaults on the next page load.
    expect(KEY in globals.__PAVILIO_PREFS__!).toBe(true);
    expect(globals.__PAVILIO_PREFS__![KEY]).toEqual([]);

    // Mounted from scratch, the way a reload mounts it: still no rows.
    view.unmount();
    render(<LauncherSettings />);
    expect(screen.queryAllByRole("textbox", { name: /^Launcher \d+ name$/ })).toHaveLength(0);
    expect(stored()).toEqual([]);
    // Nothing spliced the frozen defaults in place on the way through.
    expect(DEFAULT_TERMINAL_LAUNCHERS).toEqual(DEFAULTS);
  });

  it("rejects an entry with an empty name", async () => {
    const user = userEvent.setup();

    render(<LauncherSettings />);

    // An existing row: clearing the name and committing keeps the stored entry.
    await user.clear(nameFields()[1]);
    await user.tab();

    expect(stored()).toEqual(DEFAULTS);
    expect(nameFields()[1]).toHaveValue("codex");

    // The add form refuses the same way: a command with no name is not an entry.
    await user.type(
      screen.getByRole("textbox", { name: "New launcher command" }),
      "claude --resume",
    );
    await user.click(screen.getByRole("button", { name: "Add launcher" }));

    expect(stored()).toEqual(DEFAULTS);
    expect(nameFields()).toHaveLength(3);
  });

  it("rejects an entry with an empty command", async () => {
    const user = userEvent.setup();

    render(<LauncherSettings />);

    await user.clear(commandFields()[1]);
    await user.tab();

    expect(stored()).toEqual(DEFAULTS);
    expect(commandFields()[1]).toHaveValue("codex");

    // And a name with no command, which would send a bare return to the PTY.
    await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "resume");
    await user.click(screen.getByRole("button", { name: "Add launcher" }));

    expect(stored()).toEqual(DEFAULTS);
    expect(nameFields()).toHaveLength(3);
  });
});
