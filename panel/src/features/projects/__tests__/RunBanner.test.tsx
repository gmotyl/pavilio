import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunBanner } from "../RunBanner";
import type { TaskListStatus } from "../taskList";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  PREFERENCE_PATCH_DEBOUNCE_MS,
  writePreference,
} from "../../../preferences/store";
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
  const group = screen.getByRole("group", { name: "CLI" });
  return within(group)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
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
    expect(onRun).toHaveBeenCalledWith("/goal 'Only do task 7'");
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

    await user.click(screen.getByRole("button", { name: "codex" }));
    await user.clear(objective());
    await user.type(objective(), "My objective");
    expect(wrapper()).toBe('codex "/goal ');

    await user.click(screen.getByRole("button", { name: "opencode" }));

    expect(screen.getByRole("button", { name: "opencode" })).toHaveAttribute(
      "aria-pressed",
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
    await user.click(screen.getByRole("button", { name: "codex" }));
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
    expect(onRun).toHaveBeenCalledWith("/goal 'Kept across the fold'");
  });

  it("Ctrl+Enter in the objective runs it", async () => {
    const user = userEvent.setup();
    const onRun = renderBanner(vi.fn());

    await user.click(objective());
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(objective().value).not.toContain("\n");
  });

  it("the last CLI picked is preselected on the next banner", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const first = render(
      <RunBanner status={STATUS} project="pavilio" path={PATH} onRun={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "codex" }));
    expect(globals.__PAVILIO_PREFS__![storageKey(preferences.plansRunLauncher)]).toBe("codex");
    first.unmount();

    // Another change, another file: the pick is one choice for every change.
    const onRun = vi.fn();
    render(
      <RunBanner
        status={{ changeId: "2026-10-01-other", total: 3, remaining: 3 }}
        project="pavilio"
        path="projects/pavilio/plans/openspec/changes/2026-10-01-other/tasks.md"
        onRun={onRun}
      />,
    );

    expect(screen.getByRole("button", { name: "codex" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun.mock.calls[0][0]).toMatch(/^codex "\/goal /);
  });

  it("a remembered CLI that is no longer runnable falls back to the first", () => {
    writePreference(preferences.terminalLaunchers, [
      LAUNCHERS[0],
      { name: "codex", command: "codex" },
      LAUNCHERS[2],
    ]);
    writePreference(preferences.plansRunLauncher, "codex");
    renderBanner();

    expect(screen.getByRole("button", { name: "claude" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "codex" })).not.toBeInTheDocument();
  });

  it("reordering launchers keeps the picked CLI", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const onRun = vi.fn();
    renderBanner(onRun);
    await user.click(screen.getByRole("button", { name: "codex" }));

    act(() => {
      writePreference(preferences.terminalLaunchers, [LAUNCHERS[2], LAUNCHERS[0], LAUNCHERS[1]]);
    });

    expect(cliOptions()).toEqual(["opencode", "claude", "codex"]);
    expect(screen.getByRole("button", { name: "codex" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun.mock.calls[0][0]).toMatch(/^codex "\/goal /);
  });

  it("the CLI switch is toggle buttons: one pressed, each reached by Tab and picked by Space", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    renderBanner();

    const group = screen.getByRole("group", { name: "CLI" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);

    screen.getByRole("button", { name: "Collapse run banner" }).focus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.keyboard(" ");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    await user.tab();
    expect(buttons[2]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(buttons[2]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("run-banner-wrapper-before").textContent).toBe('opencode --prompt "');
  });

  it("a run loop that takes no prompt disables the objective and says so", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "claude --continue" },
    ]);
    const onRun = renderBanner(vi.fn());

    expect(objective()).toBeDisabled();
    expect(screen.getByText("This launcher's run loop takes no prompt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run" }));
    // What is read is what is sent: the run loop alone, no objective.
    expect(onRun).toHaveBeenCalledWith("claude --continue");
  });

  it("a later placeholder in the run loop is drawn as the objective, not as raw text", () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "tool", command: "tool", runLoop: 'tool "{prompt}" --title "{prompt}"' },
    ]);
    renderBanner();

    const after = screen.getByTestId("run-banner-wrapper-after").textContent;
    expect(after).toBe('" --title "«objective»"');
    expect(after).not.toContain("{prompt}");
  });

  it("offers no run when no launcher has a run loop", () => {
    writePreference(preferences.terminalLaunchers, [{ name: "claude", command: "claude" }]);
    renderBanner();

    expect(screen.queryByRole("group", { name: "CLI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/no launcher has a run loop/i)).toBeInTheDocument();
  });

  it("re-clicking the already-picked CLI writes no preference", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    renderBanner();
    // Nothing remembered: the first is pressed by default.
    expect(screen.getByRole("button", { name: "claude" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "claude" }));
    await new Promise((r) => setTimeout(r, PREFERENCE_PATCH_DEBOUNCE_MS + 50));

    expect(storageKey(preferences.plansRunLauncher) in globals.__PAVILIO_PREFS__!).toBe(false);
    // The launchers written above PATCH on their own; none may carry the pick.
    const picks = fetchMock.mock.calls.filter(([, init]) => {
      const req = init as RequestInit | undefined;
      return (
        req?.method === "PATCH" &&
        String(req.body).includes(storageKey(preferences.plansRunLauncher))
      );
    });
    expect(picks).toHaveLength(0);
  });

  it("a run loop with no prompt stays runnable when the template resolves to blank", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "claude --continue" },
    ]);
    writePreference(preferences.taskPromptDefault, "   ");
    const onRun = renderBanner(vi.fn());

    expect(objective().value.trim()).toBe("");
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("claude --continue");
  });

  it("the footer offers no editing or shortcut while the objective is disabled", () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "claude --continue" },
    ]);
    renderBanner();

    const foot = screen.getByTestId("run-banner-foot").textContent ?? "";
    expect(foot).not.toMatch(/editable/);
    expect(foot).not.toContain("⌘↵");
    expect(foot).toContain("opens a new terminal");
  });

  it("the footer names editing and the shortcut while the objective is live", () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    renderBanner();

    const foot = screen.getByTestId("run-banner-foot").textContent ?? "";
    expect(foot).toContain("editable for this send");
    expect(foot).toContain("⌘↵");
  });
});
