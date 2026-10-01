import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LauncherSettings } from "../LauncherSettings";
import AgentSettings from "../AgentSettings";
import {
  DEFAULT_TERMINAL_LAUNCHERS,
  preferences,
  type TerminalLauncher,
} from "../../../preferences/declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

/**
 * The realtime channel, with a hand on its frames: jsdom has no WebSocket, and
 * the store only cares that a `preferences-change` frame arrives (the pattern
 * `preferences/__tests__/usePreference.test.tsx` uses). The rest of the module
 * stays real.
 */
const { frameListeners } = vi.hoisted(() => ({
  frameListeners: new Set<(frame: { type: string; [key: string]: unknown }) => void>(),
}));

vi.mock("../../realtime/channel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../realtime/channel")>()),
  subscribeRealtime: (listener: (frame: { type: string; [key: string]: unknown }) => void) => {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
  __resetRealtimeChannelForTests: () => frameListeners.clear(),
}));

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
  { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
  { name: "codex", command: "codex", runLoop: "/goal {prompt}" },
  { name: "opencode", command: "opencode", promptFlag: "--prompt", runLoop: "{prompt}" },
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

function promptFlagFields(): HTMLInputElement[] {
  return screen.getAllByRole("textbox", {
    name: /^Launcher \d+ prompt flag$/,
  }) as HTMLInputElement[];
}

function row(index: number): HTMLElement {
  return screen.getByTestId(`launcher-row-${index}`);
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
        "/goal {prompt}",
        "/goal {prompt}",
        "{prompt}",
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

      // An explicit "" — not an absent key, which would now read as the
      // shipped default — and the flag the row carried survives the edit.
      expect(stored()[2]).toEqual({
        name: "opencode",
        command: "opencode",
        promptFlag: "--prompt",
        runLoop: "",
      });
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
      expect(runLoopFields()[1]).toHaveValue("/goal {prompt}");
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
  describe("prompt flag and shipped defaults", () => {
    it("a row edits the prompt flag", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      expect(promptFlagFields().map((field) => field.value)).toEqual(["", "", "--prompt"]);

      await user.type(promptFlagFields()[0], "-p");
      await user.tab();
      expect(stored()[0]).toEqual({
        name: "claude",
        command: "claude",
        promptFlag: "-p",
        runLoop: "/goal {prompt}",
      });

      // Clearing a flag the user had set is a choice: positional, stored "".
      await user.clear(promptFlagFields()[2]);
      await user.tab();
      expect(stored()[2]).toEqual({
        name: "opencode",
        command: "opencode",
        promptFlag: "",
        runLoop: "{prompt}",
      });

      // A row whose flag field was never touched does not grow a flag key.
      await user.clear(commandFields()[1]);
      await user.type(commandFields()[1], "codex --no-daemon");
      await user.tab();
      expect(stored()[1]).toEqual({
        name: "codex",
        command: "codex --no-daemon",
        runLoop: "/goal {prompt}",
      });

      // The add form takes a flag too.
      await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "oc");
      await user.type(screen.getByRole("textbox", { name: "New launcher command" }), "opencode");
      await user.type(
        screen.getByRole("textbox", { name: "New launcher prompt flag" }),
        "--prompt",
      );
      await user.click(screen.getByRole("button", { name: "Add launcher" }));
      expect(stored().at(-1)).toEqual({ name: "oc", command: "opencode", promptFlag: "--prompt" });
    });

    it("a missing run loop shows the shipped default and writes nothing", async () => {
      const user = userEvent.setup();
      globals.__PAVILIO_PREFS__ = {
        ...globals.__PAVILIO_PREFS__,
        [KEY]: [
          { name: "claude", command: "claude" },
          { name: "resume", command: "claude --resume" },
          { name: "opencode", command: "opencode" },
        ],
      };

      render(<LauncherSettings />);
      // The default is a placeholder, not a value: typing replaces it.
      expect(runLoopFields()[0]).toHaveValue("");
      expect(runLoopFields()[0]).toHaveAttribute("placeholder", "/goal {prompt}");
      expect(within(row(0)).getByText("shipped default")).toBeInTheDocument();
      // An unknown name has no default to show.
      expect(runLoopFields()[1]).toHaveAttribute("placeholder", "not offered for runs");
      expect(within(row(1)).queryByText("shipped default")).toBeNull();
      // The flag's default is shown the same way.
      expect(promptFlagFields()[2]).toHaveValue("");
      expect(promptFlagFields()[2]).toHaveAttribute("placeholder", "--prompt");

      // Editing another column writes neither a run loop nor a flag.
      await user.clear(commandFields()[0]);
      await user.type(commandFields()[0], "claude --verbose");
      await user.tab();
      expect(stored()[0]).toEqual({ name: "claude", command: "claude --verbose" });
      await user.click(runLoopFields()[2]);
      await user.tab();
      expect(stored()[2]).toEqual({ name: "opencode", command: "opencode" });

      // Typing into the field stores what was typed.
      await user.type(runLoopFields()[0], "/goal now {{prompt}");
      await user.tab();
      expect(stored()[0]).toEqual({
        name: "claude",
        command: "claude --verbose",
        runLoop: "/goal now {prompt}",
      });
      expect(within(row(0)).queryByText("shipped default")).toBeNull();
    });

    it("clearing a run loop offers to restore the default", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      await user.clear(runLoopFields()[0]);
      await user.tab();

      expect(stored()[0]).toEqual({ name: "claude", command: "claude", runLoop: "" });
      expect(runLoopFields()[0]).toHaveAttribute("placeholder", "not offered for runs");
      expect(within(row(0)).getByText("not offered for runs")).toBeInTheDocument();

      await user.click(
        within(row(0)).getByRole("button", { name: /restore default/i }),
      );
      // Restoring removes the key, so the name's default applies again.
      expect(stored()[0]).toEqual({ name: "claude", command: "claude" });
      expect("runLoop" in stored()[0]).toBe(false);
      expect(runLoopFields()[0]).toHaveAttribute("placeholder", "/goal {prompt}");
      expect(within(row(0)).getByText("shipped default")).toBeInTheDocument();
      expect(within(row(0)).queryByRole("button", { name: /restore default/i })).toBeNull();

      // An unknown name cleared to "" has nothing to restore.
      await user.type(screen.getByRole("textbox", { name: "New launcher name" }), "resume");
      await user.type(
        screen.getByRole("textbox", { name: "New launcher command" }),
        "claude --resume",
      );
      await user.type(
        screen.getByRole("textbox", { name: "New launcher run loop" }),
        "go on",
      );
      await user.click(screen.getByRole("button", { name: "Add launcher" }));
      await user.clear(runLoopFields()[3]);
      await user.tab();
      expect(stored()[3]).toEqual({ name: "resume", command: "claude --resume", runLoop: "" });
      expect(within(row(3)).queryByRole("button", { name: /restore default/i })).toBeNull();
    });

    it("a defaulted run loop is turned off in one step", async () => {
      const user = userEvent.setup();
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude" },
        { name: "resume", command: "claude --resume", runLoop: "go on" },
      ]);

      render(<LauncherSettings />);
      // Clearing a placeholder is not an edit, so it cannot turn the default off.
      await user.clear(runLoopFields()[0]);
      await user.tab();
      expect(stored()[0]).toEqual({ name: "claude", command: "claude" });

      await user.click(within(row(0)).getByRole("button", { name: "Don't offer launcher 1 for runs" }));
      expect(stored()[0]).toEqual({ name: "claude", command: "claude", runLoop: "" });
      expect(within(row(0)).getByText("not offered for runs")).toBeInTheDocument();
      expect(within(row(0)).queryByTestId("launcher-disable-run-loop-0")).toBeNull();

      // …and back in one step.
      await user.click(within(row(0)).getByTestId("launcher-restore-run-loop-0"));
      expect(stored()[0]).toEqual({ name: "claude", command: "claude" });
      expect(within(row(0)).getByTestId("launcher-disable-run-loop-0")).toBeInTheDocument();

      // A stored run loop is the user's; there is no default to turn off.
      expect(within(row(1)).queryByTestId("launcher-disable-run-loop-1")).toBeNull();
    });

    it("a defaulted prompt flag is made positional in one step", async () => {
      const user = userEvent.setup();
      writePreference(preferences.terminalLaunchers, [
        { name: "opencode", command: "opencode" },
        { name: "claude", command: "claude" },
        { name: "opencode", command: "opencode", promptFlag: "--prompt" },
      ]);

      render(<LauncherSettings />);
      expect(promptFlagFields()[0]).toHaveAttribute("placeholder", "--prompt");
      // Clearing the placeholder writes nothing.
      await user.clear(promptFlagFields()[0]);
      await user.tab();
      expect(stored()[0]).toEqual({ name: "opencode", command: "opencode" });

      await user.click(
        within(row(0)).getByRole("button", { name: "Make the prompt positional for launcher 1" }),
      );
      expect(stored()[0]).toEqual({ name: "opencode", command: "opencode", promptFlag: "" });
      expect(promptFlagFields()[0]).toHaveAttribute("placeholder", "positional");
      expect(within(row(0)).queryByTestId("launcher-positional-flag-0")).toBeNull();

      await user.click(
        within(row(0)).getByRole("button", { name: "Use the default prompt flag for launcher 1" }),
      );
      expect(stored()[0]).toEqual({ name: "opencode", command: "opencode" });
      expect("promptFlag" in stored()[0]).toBe(false);
      expect(promptFlagFields()[0]).toHaveAttribute("placeholder", "--prompt");
      expect(within(row(0)).queryByTestId("launcher-default-flag-0")).toBeNull();

      // No shipped flag: nothing to turn off and nothing to go back to.
      expect(within(row(1)).queryByTestId("launcher-positional-flag-1")).toBeNull();
      expect(within(row(1)).queryByTestId("launcher-default-flag-1")).toBeNull();
      // A stored flag equal to the shipped one has no different default.
      expect(within(row(2)).queryByTestId("launcher-positional-flag-2")).toBeNull();
      expect(within(row(2)).queryByTestId("launcher-default-flag-2")).toBeNull();
    });

    it("a whole-line run loop is flagged and fixed", async () => {
      const user = userEvent.setup();
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
        { name: "opencode", command: "opencode", runLoop: 'opencode --prompt "goal: x {prompt}"' },
      ]);

      render(<LauncherSettings />);
      expect(
        within(row(0)).queryByText(/looks like a whole command line/),
      ).toBeNull();
      expect(
        within(row(1)).getByText(
          "This looks like a whole command line — the command is added for you.",
        ),
      ).toBeInTheDocument();

      await user.click(within(row(1)).getByRole("button", { name: /^Fix/ }));
      expect(stored()[1]).toEqual({
        name: "opencode",
        command: "opencode",
        promptFlag: "--prompt",
        runLoop: "goal: x {prompt}",
      });
      expect(runLoopFields()[1]).toHaveValue("goal: x {prompt}");
      expect(promptFlagFields()[1]).toHaveValue("--prompt");
      expect(within(row(1)).queryByText(/looks like a whole command line/)).toBeNull();
    });

    it("a whole-line warning uses the panel's own red", () => {
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: 'claude "/goal now {prompt}"' },
      ]);

      render(<LauncherSettings />);
      // `--red` is declared in index.css; the old `--status-error` never was,
      // so its fallback hex was all that ever rendered.
      expect(runLoopFields()[0].style.borderColor).toBe("var(--red)");
      expect(within(row(0)).getByRole("alert").style.color).toBe("var(--red)");
    });

    it("a blank name or command is still rejected", async () => {
      const user = userEvent.setup();

      render(<LauncherSettings />);
      // A dirty flag draft WITHOUT a blur, so no commit has run for it yet.
      fireEvent.change(promptFlagFields()[0], { target: { value: "-p" } });
      await user.clear(nameFields()[0]);
      await user.tab();
      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()[0]).toHaveValue("claude");
      expect(promptFlagFields()[0]).toHaveValue("");

      await user.clear(commandFields()[2]);
      await user.tab();
      expect(stored()).toEqual(DEFAULTS);
      expect(commandFields()[2]).toHaveValue("opencode");

      // A flag and a run loop do not rescue an add without a name.
      await user.type(screen.getByRole("textbox", { name: "New launcher command" }), "x");
      await user.type(screen.getByRole("textbox", { name: "New launcher prompt flag" }), "-p");
      await user.type(screen.getByRole("textbox", { name: "New launcher run loop" }), "go");
      await user.click(screen.getByRole("button", { name: "Add launcher" }));
      expect(stored()).toEqual(DEFAULTS);
      expect(nameFields()).toHaveLength(3);
    });
  });

  describe("display details", () => {
    it("a shipped default is dashed and a stored value is not", () => {
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude" },
        { name: "codex", command: "codex", runLoop: "/goal {prompt}" },
        { name: "opencode", command: "opencode" },
      ]);

      render(<LauncherSettings />);
      // Dashed is the "shipped default" marker the help text points at.
      expect(runLoopFields()[0].style.borderStyle).toBe("dashed");
      expect(runLoopFields()[1].style.borderStyle).not.toBe("dashed");
      // A defaulted flag gets the same marker; a name with no flag to default does not.
      expect(promptFlagFields()[2].style.borderStyle).toBe("dashed");
      expect(promptFlagFields()[0].style.borderStyle).not.toBe("dashed");
    });

    it("the help text says what the run loop and the prompt flag are", () => {
      render(<LauncherSettings />);
      const help = screen.getByText(/The pills on a cell/);
      const text = help.textContent!.replace(/\s+/g, " ");
      expect(text).toContain("The run loop is the text the CLI receives when a task run starts");
      expect(text).toContain("{prompt} standing for the objective");
      expect(text).toContain("no quotes or shell syntax");
      expect(text).toContain("The prompt flag is how the command takes that text");
      expect(text).toContain("leave it blank when the prompt is a plain argument");
      expect(text).toContain("A dashed field is the shipped default");
      expect(text).toContain("don't offer for runs");
    });

    it("a stored legacy whole line displays as the shipped default", () => {
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
        { name: "opencode", command: "opencode", runLoop: 'opencode --prompt "{prompt}"' },
      ]);

      render(<LauncherSettings />);
      for (const [index, placeholder] of [
        [0, "/goal {prompt}"],
        [1, "{prompt}"],
      ] as const) {
        expect(runLoopFields()[index]).toHaveValue("");
        expect(runLoopFields()[index]).toHaveAttribute("placeholder", placeholder);
        expect(runLoopFields()[index].style.borderStyle).toBe("dashed");
        expect(within(row(index)).getByText("shipped default")).toBeInTheDocument();
        // The old default written back is not the user's whole line.
        expect(within(row(index)).queryByRole("alert")).toBeNull();
      }
      // The legacy opencode line carried its own flag; the shipped one shows.
      expect(promptFlagFields()[1]).toHaveAttribute("placeholder", "--prompt");
    });
  });

  it("a hand-edited non-list shows the shipped launchers instead of crashing", () => {
    globals.__PAVILIO_PREFS__![KEY] = 5;
    render(<LauncherSettings />);
    expect(nameFields().map((f) => f.value)).toEqual(["claude", "codex", "opencode"]);
  });

  describe("a write from elsewhere", () => {
    /**
     * Any change of the stored list resets every row's drafts, the row being
     * typed into included — even when the write left that row's own launcher
     * alone. Rows are keyed by position, so an edit kept across a change could
     * land on another launcher; it is dropped instead.
     */
    it("an outside change resets a row being edited", async () => {
      const user = userEvent.setup();
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      writePreference(preferences.terminalLaunchers, [a, b]);
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      await user.type(commandFields()[0], " --verbose");
      act(() =>
        writePreference(preferences.terminalLaunchers, [a, { name: "beta2", command: "beta" }]),
      );

      expect(commandFields()[0]).toHaveValue("alpha");
      expect(commandFields()[0]).toHaveFocus();
      expect(nameFields().map((f) => f.value)).toEqual(["alpha", "beta2"]);
    });

    it("a blur after an outside change writes nothing", async () => {
      const user = userEvent.setup();
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      ]);
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      await user.type(commandFields()[0], " --verbose");
      act(() =>
        writePreference(preferences.terminalLaunchers, [
          { name: "claude", command: "claude", runLoop: "/goal again {prompt}" },
        ]),
      );
      expect(commandFields()[0]).toHaveValue("claude");
      await user.click(document.body);

      expect(stored()).toEqual([
        { name: "claude", command: "claude", runLoop: "/goal again {prompt}" },
      ]);
    });

    it("an edit to a row removed elsewhere is dropped and writes nothing", async () => {
      const user = userEvent.setup();
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      const c = { name: "gamma", command: "gamma" };
      writePreference(preferences.terminalLaunchers, [a, b, c]);
      render(<LauncherSettings />);

      await user.click(commandFields()[1]);
      await user.type(commandFields()[1], " --edited");
      act(() => writePreference(preferences.terminalLaunchers, [a, c]));

      expect(commandFields().map((f) => f.value)).toEqual(["alpha", "gamma"]);
      await user.click(document.body);
      expect(stored()).toEqual([a, c]);
    });

    /**
     * The probe: `alpha` is being edited while one write elsewhere removes it
     * AND renames `beta`. `beta2` then sits where `alpha` was; the row must not
     * take it as `alpha` edited in place, or the blur writes alpha's edit over
     * beta's command.
     */
    it("an edit to a row removed elsewhere is not carried onto a renamed neighbour", async () => {
      const user = userEvent.setup();
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      const c = { name: "gamma", command: "gamma" };
      writePreference(preferences.terminalLaunchers, [a, b, c]);
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      await user.type(commandFields()[0], " X");
      act(() =>
        writePreference(preferences.terminalLaunchers, [{ name: "beta2", command: "beta" }, c]),
      );

      expect(nameFields().map((f) => f.value)).toEqual(["beta2", "gamma"]);
      expect(commandFields().map((f) => f.value)).toEqual(["beta", "gamma"]);
      await user.click(document.body);
      expect(stored()).toEqual([{ name: "beta2", command: "beta" }, c]);
    });

    /**
     * The write guards. A write elsewhere that lands after the row last
     * rendered — the store notified, React not yet re-rendered — leaves the
     * row's handlers holding the entry it SHOWED. Written at its index without
     * the guard, the edit (or the removal) would hit whatever sits there now.
     * `writePreference` outside `act` is that gap: the hook's latest value moves
     * at once, the render waits.
     */
    it("an edit committed after a write elsewhere moved its entry writes nothing", async () => {
      const user = userEvent.setup();
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      writePreference(preferences.terminalLaunchers, [a, b]);
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      await user.type(commandFields()[0], " X");
      const field = commandFields()[0];
      writePreference(preferences.terminalLaunchers, [b]);
      fireEvent.blur(field);

      expect(stored()).toEqual([b]);
    });

    it("a removal clicked after a write elsewhere moved its entry removes nothing", () => {
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      writePreference(preferences.terminalLaunchers, [a, b]);
      render(<LauncherSettings />);

      const remove = screen.getByTestId("launcher-remove-0");
      writePreference(preferences.terminalLaunchers, [b]);
      fireEvent.click(remove);

      expect(stored()).toEqual([b]);
    });

    /**
     * The echo. The server broadcasts every write to every tab, this one
     * included, and the refetch it triggers hands back the SAME list as a new
     * array. The rows reset on a change of the list's VALUE (`listKey` is the
     * serialized list), so the echo of a commit must not wipe what is being
     * typed into the next field by then.
     */
    it("the echo of this tab's own write does not wipe the next field's draft", async () => {
      const user = userEvent.setup();
      const a = { name: "alpha", command: "alpha" };
      const b = { name: "beta", command: "beta" };
      writePreference(preferences.terminalLaunchers, [a, b]);
      // The server answers PATCHes and serves back whatever this tab now holds —
      // the document with its own write applied, as the echo's refetch sees it.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url === "/api/preferences.js"
            ? new Response(
                `window.__PAVILIO_PREFS__ = ${JSON.stringify(globals.__PAVILIO_PREFS__)};\n`,
                { status: 200 },
              )
            : new Response('{"ok":true}', { status: 200 }),
        ),
      );
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      await user.type(commandFields()[0], " --one");
      await user.click(commandFields()[1]);
      expect(stored()).toEqual([{ name: "alpha", command: "alpha --one" }, b]);
      // The PATCH goes out and acks, so the refetch below answers from the
      // server's copy — a fresh array — rather than this tab's pending value.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
      });
      await user.type(commandFields()[1], " --two");

      await act(async () => {
        for (const listener of [...frameListeners]) {
          listener({ type: "preferences-change", keys: [KEY] });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(commandFields()[1]).toHaveValue("beta --two");
      expect(commandFields()[1]).toHaveFocus();
      await user.click(document.body);
      expect(stored()).toEqual([
        { name: "alpha", command: "alpha --one" },
        { name: "beta", command: "beta --two" },
      ]);
    });

    it("an unfocused row follows it", () => {
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      ]);
      render(<LauncherSettings />);

      act(() =>
        writePreference(preferences.terminalLaunchers, [
          { name: "claude", command: "claude -c", runLoop: "/goal again {prompt}" },
        ]),
      );
      expect(commandFields()[0]).toHaveValue("claude -c");
      expect(runLoopFields()[0]).toHaveValue("/goal again {prompt}");
    });

    it("a focused row with no edit follows it", async () => {
      const user = userEvent.setup();
      writePreference(preferences.terminalLaunchers, [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      ]);
      render(<LauncherSettings />);

      await user.click(commandFields()[0]);
      act(() =>
        writePreference(preferences.terminalLaunchers, [
          { name: "claude", command: "claude -c", runLoop: "/goal {prompt}" },
        ]),
      );
      expect(commandFields()[0]).toHaveValue("claude -c");
      await user.tab();
      expect(stored()).toEqual([
        { name: "claude", command: "claude -c", runLoop: "/goal {prompt}" },
      ]);
    });
  });

  describe("layout", () => {
    /**
     * jsdom lays nothing out, so this pins the class contract that the
     * headless-Chrome measurement relied on: at a 420px Settings width a
     * non-wrapping row overflowed and squeezed the run loop to 18px. The row
     * wraps, each growing field has a real flex BASIS (not `flex-1`, whose 0%
     * basis lets it be crushed), and the flag field is wide enough for its
     * "positional" / "prompt flag" placeholders.
     */
    it("a row and the add form wrap instead of crushing a field", () => {
      render(<LauncherSettings />);

      expect(row(0)).toHaveClass("flex-wrap");
      expect(commandFields()[0]).toHaveClass("basis-32");
      expect(screen.getByTestId("launcher-run-loop-cell-0")).toHaveClass("basis-64");
      expect(screen.getByTestId("launcher-prompt-flag-cell-0")).toHaveClass("w-32");

      const add = screen.getByTestId("launcher-add").parentElement!;
      expect(add).toHaveClass("flex-wrap");
      expect(screen.getByTestId("launcher-new-run-loop")).toHaveClass("basis-64");
      expect(screen.getByTestId("launcher-new-prompt-flag")).toHaveClass("w-32");
      for (const field of screen.getAllByRole("textbox")) {
        expect(field).not.toHaveClass("flex-1");
      }
    });
  });
});
