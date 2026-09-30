import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
  { name: "codex", command: "codex", runLoop: 'codex "/goal {prompt}"' },
  { name: "opencode", command: "opencode", runLoop: 'opencode --prompt "{prompt}"' },
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

function runLoopFields(): HTMLInputElement[] {
  return screen.getAllByRole("textbox", { name: /^Launcher \d+ run loop$/ }) as HTMLInputElement[];
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
    expect(stored()).toEqual([DEFAULTS[0], DEFAULTS[2]]);

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

  describe("the run-loop column", () => {
    it("the shipped defaults carry a run loop for each agent", () => {
      // Nothing stored: the read is the declared default, written out above.
      expect(stored()).toEqual(DEFAULTS);
      expect(stored().every((entry) => Boolean(entry.runLoop))).toBe(true);

      render(<LauncherSettings />);
      expect(runLoopFields().map((field) => field.value)).toEqual([
        'claude "/goal {prompt}"',
        'codex "/goal {prompt}"',
        'opencode --prompt "{prompt}"',
      ]);
    });

    it("an entry with a blank run loop is saved", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "resume");
      await user.type(
        screen.getByRole("textbox", { name: "New launcher command" }),
        "claude --resume",
      );
      // The run-loop field is left blank: that launcher is simply not offered
      // for a run, which is an honest answer and must stay saveable.
      await user.click(screen.getByRole("button", { name: "Add launcher" }));

      expect(stored()).toEqual([...DEFAULTS, { name: "resume", command: "claude --resume" }]);

      // Clearing an existing row's run loop is a committed edit too.
      await user.clear(runLoopFields()[2]);
      await user.tab();

      expect(stored()[2]).toEqual({ name: "opencode", command: "opencode" });
      expect(stored()).toHaveLength(4);
    });

    it("an entry with a run loop typed into the add form keeps it", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "yolo");
      await user.type(screen.getByRole("textbox", { name: "New launcher command" }), "claude");
      // `{` is a userEvent key-descriptor opener; `{{` types a literal brace.
      await user.type(
        screen.getByRole("textbox", { name: "New launcher run loop" }),
        'claude "/goal {{prompt}"',
      );
      await user.click(screen.getByRole("button", { name: "Add launcher" }));

      expect(stored().at(-1)).toEqual({
        name: "yolo",
        command: "claude",
        runLoop: 'claude "/goal {prompt}"',
      });
      expect(screen.getByRole("textbox", { name: "New launcher run loop" })).toHaveValue("");
    });

    it("an entry with a blank name is still rejected", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      await user.type(screen.getByRole("textbox", { name: "New launcher command" }), "claude");
      await user.type(
        screen.getByRole("textbox", { name: "New launcher run loop" }),
        'claude "/goal {{prompt}"',
      );
      await user.click(screen.getByRole("button", { name: "Add launcher" }));

      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()).toHaveLength(3);

      // A run loop alone does not rescue a row whose name was cleared.
      await user.clear(nameFields()[0]);
      await user.tab();
      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()[0]).toHaveValue("claude");
    });

    it("a rejected row edit restores the run-loop draft as well", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      // A run-loop draft left dirty WITHOUT a blur: `fireEvent.change` moves the
      // field's value but not the focus, so no commit has run for it yet.
      fireEvent.change(runLoopFields()[1], { target: { value: "codex --unsaved" } });
      expect(runLoopFields()[1]).toHaveValue("codex --unsaved");

      // Blanking the same row's name and committing rejects the whole edit, so
      // every field shows what is stored — the run loop included, not the
      // draft the panel never kept.
      await user.clear(nameFields()[1]);
      await user.tab();

      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()[1]).toHaveValue("codex");
      expect(runLoopFields()[1]).toHaveValue('codex "/goal {prompt}"');
    });

    it("an entry with a blank command is still rejected", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "yolo");
      await user.type(
        screen.getByRole("textbox", { name: "New launcher run loop" }),
        'claude "/goal {{prompt}"',
      );
      await user.click(screen.getByRole("button", { name: "Add launcher" }));

      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()).toHaveLength(3);

      await user.clear(commandFields()[0]);
      await user.tab();
      expect(stored()).toEqual(DEFAULTS);
      expect(commandFields()[0]).toHaveValue("claude");
    });

    it("a stored list predating the column loads without a run loop", async () => {
      const user = userEvent.setup();
      // The exact shape a workspace document held before this change, placed
      // straight into the document rather than through `writePreference`.
      globals.__PAVILIO_PREFS__ = {
        ...globals.__PAVILIO_PREFS__,
        [KEY]: [
          { name: "claude", command: "claude" },
          { name: "resume", command: "claude --resume" },
        ],
      };

      expect(() => render(<LauncherSettings />)).not.toThrow();
      expect(stored()).toEqual([
        { name: "claude", command: "claude" },
        { name: "resume", command: "claude --resume" },
      ]);
      expect(stored().some((entry) => "runLoop" in entry)).toBe(false);
      expect(runLoopFields().map((field) => field.value)).toEqual(["", ""]);

      // Editing another column of an old entry does not invent a run loop.
      await user.clear(commandFields()[1]);
      await user.type(commandFields()[1], "claude --continue");
      await user.tab();
      expect(stored()[1]).toEqual({ name: "resume", command: "claude --continue" });
    });

    it("editing a row does not mutate the declared defaults", async () => {
      const user = userEvent.setup();
      const before = stored();
      // Nothing stored, so this IS the declared array, handed back by reference.
      expect(before).toBe(DEFAULT_TERMINAL_LAUNCHERS);
      const firstEntry = DEFAULT_TERMINAL_LAUNCHERS[0];

      render(<LauncherSettings />);
      await user.clear(runLoopFields()[0]);
      await user.type(runLoopFields()[0], "claude --print {{prompt}");
      await user.tab();

      const after = stored();
      expect(after[0]).toEqual({
        name: "claude",
        command: "claude",
        runLoop: "claude --print {prompt}",
      });
      // A new array and a new entry object; the declared ones are untouched.
      expect(after).not.toBe(DEFAULT_TERMINAL_LAUNCHERS);
      expect(after[0]).not.toBe(firstEntry);
      expect(DEFAULT_TERMINAL_LAUNCHERS[0]).toBe(firstEntry);
      expect(DEFAULT_TERMINAL_LAUNCHERS).toEqual(DEFAULTS);
    });
  });
});
