import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunBanner } from "../RunBanner";
import type { TaskListStatus } from "../taskList";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { writeOverride } from "../../../preferences/overridable";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const STATUS: TaskListStatus = {
  changeId: "2026-09-28-commands-in-context",
  total: 17,
  remaining: 12,
};
const PATH = "projects/pavilio/plans/openspec/changes/2026-09-28-commands-in-context/tasks.md";

const LAUNCHERS: TerminalLauncher[] = [
  { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
  { name: "codex", command: "codex", runLoop: 'codex "/goal {prompt}"' },
  { name: "opencode", command: "opencode", runLoop: 'opencode --prompt "{prompt}"' },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderBanner(onRun: (runLine: string) => void = vi.fn()) {
  render(<RunBanner status={STATUS} project="pavilio" path={PATH} onRun={onRun} />);
  return onRun;
}

function objective(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Objective" }) as HTMLTextAreaElement;
}

function cliOptions(): string[] {
  const group = screen.getByRole("radiogroup", { name: "CLI" });
  return within(group)
    .getAllByRole("radio")
    .map((radio) => radio.textContent ?? "");
}

describe("RunBanner", () => {
  it("shows the remaining count and a proportional progress bar", () => {
    renderBanner();

    expect(screen.getByText("12 of 17 tasks left")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Tasks done" });
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(bar).toHaveAttribute("aria-valuemax", "17");
    // One segment per task, the checked ones filled.
    const segments = bar.querySelectorAll("[data-segment]");
    expect(segments).toHaveLength(17);
    expect(bar.querySelectorAll('[data-segment="done"]')).toHaveLength(5);
  });

  it("substitutes change, path and project into the shown prompt", () => {
    writeOverride(
      preferences.taskPromptOverride,
      "Change {change} of {project}: work through {path}.",
      "pavilio",
    );
    renderBanner();

    expect(objective().value).toBe(
      `Change 2026-09-28-commands-in-context of pavilio: work through ${PATH}.`,
    );
    expect(objective().value).not.toMatch(/\{(change|path|project)\}/);
  });

  it("an edit to the objective is used for the send and stored nowhere", async () => {
    const user = userEvent.setup();
    // Nothing is written before the snapshot: a write here would queue its own
    // debounced PATCH and land inside the window this test watches.
    const before = structuredClone(globals.__PAVILIO_PREFS__);
    const localBefore = localStorage.length;
    fetchMock.mockClear();
    const onRun = renderBanner(vi.fn());

    await user.clear(objective());
    await user.type(objective(), "Only do task 7");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith('claude "/goal Only do task 7"');
    // No preference moved: the document, browser storage and the PATCH
    // channel are all exactly as they were before the edit.
    expect(globals.__PAVILIO_PREFS__).toEqual(before);
    expect(localStorage.length).toBe(localBefore);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a launcher with no run loop is not offered", () => {
    writePreference(preferences.terminalLaunchers, [
      LAUNCHERS[0],
      { name: "codex", command: "codex" },
      { name: "blank", command: "blank", runLoop: "   " },
      LAUNCHERS[2],
    ]);
    renderBanner();

    expect(cliOptions()).toEqual(["claude", "opencode"]);
  });

  it("moving the switch redraws the wrapper and leaves the objective alone", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const onRun = renderBanner(vi.fn());
    const wrapper = () => screen.getByTestId("run-banner-wrapper-before").textContent;

    await user.click(screen.getByRole("radio", { name: "codex" }));
    await user.clear(objective());
    await user.type(objective(), "My objective");
    expect(wrapper()).toBe('codex "/goal ');

    await user.click(screen.getByRole("radio", { name: "opencode" }));

    expect(screen.getByRole("radio", { name: "opencode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(wrapper()).toBe('opencode --prompt "');
    expect(screen.getByTestId("run-banner-wrapper-after").textContent).toBe('"');
    expect(objective().value).toBe("My objective");

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith('opencode --prompt "My objective"');
  });

  it("the wrapper is not editable", () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    renderBanner();

    // The objective is the only field in the prompt; the wrapper is text.
    const prompt = screen.getByTestId("run-banner-prompt");
    expect(within(prompt).getAllByRole("textbox")).toEqual([objective()]);
    for (const id of ["run-banner-wrapper-before", "run-banner-wrapper-after"]) {
      const part = screen.getByTestId(id);
      expect(part.tagName).toBe("SPAN");
      expect(part).not.toHaveAttribute("contenteditable");
      expect(part).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("the chevron collapses to a single row that can still be run", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const onRun = renderBanner(vi.fn());

    await user.click(screen.getByRole("button", { name: "Collapse run banner" }));

    expect(screen.queryByRole("textbox", { name: "Objective" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("12 of 17 left")).toBeInTheDocument();
    expect(cliOptions()).toEqual(["claude", "codex", "opencode"]);
    expect(screen.getByRole("button", { name: "Expand run banner" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Still runnable from the single row, with the resolved default objective.
    await user.click(screen.getByRole("radio", { name: "codex" }));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith(
      `codex "/goal Implement all tasks in ${PATH}; done when every task is checked and tests + lint pass."`,
    );
    // The fold itself is the one remembered toggle.
    expect(globals.__PAVILIO_PREFS__![storageKey(preferences.plansBannerExpanded)]).toBe(false);
  });

  it("it starts expanded when nothing has been chosen", () => {
    renderBanner();

    expect(objective()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse run banner" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("an edit survives collapsing and expanding again", async () => {
    const user = userEvent.setup();
    const onRun = renderBanner(vi.fn());

    fireEvent.change(objective(), { target: { value: "Kept across the fold" } });
    await user.click(screen.getByRole("button", { name: "Collapse run banner" }));
    await user.click(screen.getByRole("button", { name: "Expand run banner" }));

    expect(objective().value).toBe("Kept across the fold");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith('claude "/goal Kept across the fold"');
  });

  it("Ctrl+Enter in the objective runs it", async () => {
    const user = userEvent.setup();
    const onRun = renderBanner(vi.fn());

    await user.click(objective());
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(objective().value).not.toContain("\n");
  });

  it("offers no run when no launcher has a run loop", () => {
    writePreference(preferences.terminalLaunchers, [{ name: "claude", command: "claude" }]);
    renderBanner();

    expect(screen.queryByRole("radiogroup", { name: "CLI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/no launcher has a run loop/i)).toBeInTheDocument();
  });
});
