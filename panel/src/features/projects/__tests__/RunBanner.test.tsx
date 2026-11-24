import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunBanner } from "../RunBanner";
import type { TaskListStatus } from "../taskList";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  PREFERENCE_PATCH_DEBOUNCE_MS,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import { writeOverride } from "../../../preferences/overridable";
import { storageKey } from "../../../preferences/types";
import { MemoryRouter } from "react-router-dom";
import { taskRunLine } from "../runPrompt";

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

/**
 * `onRun` receives the launcher and the objective; the spy is handed the line
 * the Plans tab would compose from them, so what is asserted is what is sent.
 */
function renderBanner(onRun: (runLine: string | null) => void = vi.fn()) {
  render(
    <MemoryRouter>
      <RunBanner
        status={STATUS}
        project="pavilio"
        path={PATH}
        onRun={(run) => onRun(taskRunLine(run.launcher, run.objective))}
      />
    </MemoryRouter>,
  );
  return onRun;
}

function objective(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Objective" }) as HTMLTextAreaElement;
}

/** No control of the retired CLI switch, by test id or by role. */
function expectNoCliSwitch() {
  expect(document.querySelector('[data-testid^="run-banner-cli"]')).toBeNull();
  expect(screen.queryByRole("group", { name: "CLI" })).toBeNull();
}

/** The project's whole-line pick, and the ready default beside it. */
function writeBlockedPick() {
  writePreference(preferences.terminalLaunchers, [
    LAUNCHERS[0],
    { name: "mine", command: "claude", runLoop: 'claude "/goal {prompt}"' },
  ]);
  writePreference(preferences.projectRunLauncher, "mine", "pavilio");
}

/** Neither stored nor PATCHed: the banner never writes the workspace pick. */
async function expectNoWorkspacePickWritten() {
  await new Promise((r) => setTimeout(r, PREFERENCE_PATCH_DEBOUNCE_MS + 50));
  expect(storageKey(preferences.plansRunLauncher) in globals.__PAVILIO_PREFS__!).toBe(false);
  const picks = fetchMock.mock.calls.filter(([, init]) => {
    const req = init as RequestInit | undefined;
    return (
      req?.method === "PATCH" && String(req.body).includes(storageKey(preferences.plansRunLauncher))
    );
  });
  expect(picks).toHaveLength(0);
}

describe("RunBanner", () => {
  it("shows via <cli> linking to the Overview and no CLI switch", () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    writePreference(preferences.projectRunLauncher, "codex", "pavilio");
    renderBanner();

    expectNoCliSwitch();
    const via = screen.getByRole("link", { name: "via codex" });
    expect(via).toHaveAttribute("href", "/project/pavilio");
    expect(via.nextElementSibling).toBe(screen.getByTestId("run-banner-run"));
  });

  it("collapsed and done banners carry the via label", () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    writePreference(preferences.projectRunLauncher, "opencode", "pavilio");
    writePreference(preferences.plansBannerExpanded, false);
    renderBanner();

    expect(screen.getByRole("button", { name: "Expand run banner" })).toBeInTheDocument();
    expectNoCliSwitch();
    const collapsed = screen.getByRole("link", { name: "via opencode" });
    expect(collapsed).toHaveAttribute("href", "/project/pavilio");
    expect(collapsed.nextElementSibling).toBe(screen.getByTestId("run-banner-run"));
    cleanup();

    render(
      <MemoryRouter>
        <RunBanner
          status={{ changeId: STATUS.changeId, total: 6, remaining: 0 }}
          project="pavilio"
          path={PATH}
          onRun={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    );
    expectNoCliSwitch();
    const done = screen.getByRole("link", { name: "via opencode" });
    expect(done).toHaveAttribute("href", "/project/pavilio");
    expect(done.nextElementSibling).toBe(screen.getByTestId("run-banner-archive"));
  });

  it("wrapper is composed from the project's Agent CLI", () => {
    writePreference(preferences.terminalLaunchers, [
      LAUNCHERS[0],
      { name: "codex", command: "codex --no-daemon", runLoop: "/goal {prompt}" },
    ]);
    writePreference(preferences.projectRunLauncher, "codex", "pavilio");
    renderBanner();

    expect(screen.getByTestId("run-banner-wrapper-before").textContent).toBe(
      "codex --no-daemon '/goal ",
    );
    expect(screen.getByTestId("run-banner-wrapper-after").textContent).toBe("'");
  });

  it("whole-line launcher blocks Run and points at the Overview", async () => {
    const user = userEvent.setup();
    writeBlockedPick();
    const onRun = vi.fn();
    const onArchive = vi.fn();
    render(
      <MemoryRouter>
        <RunBanner
          status={STATUS}
          project="pavilio"
          path={PATH}
          onRun={onRun}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    );

    const note = screen.getByTestId("run-banner-blocked");
    expect(note.textContent).toMatch(/whole command line/i);
    expect(within(note).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/project/pavilio",
    );
    // The note takes the wrapper's place: no line is drawn that would not run.
    expect(screen.queryByTestId("run-banner-wrapper-before")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByTestId("run-banner-archive")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(objective());
    await user.keyboard("{Control>}{Enter}{/Control}");
    fireEvent.click(screen.getByTestId("run-banner-archive"));
    expect(onRun).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("Run passes the project launcher to onRun", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    writePreference(preferences.projectRunLauncher, "opencode", "pavilio");
    const onRun = vi.fn();
    const onArchive = vi.fn();
    render(
      <MemoryRouter>
        <RunBanner
          status={{ changeId: STATUS.changeId, total: 6, remaining: 0 }}
          project="pavilio"
          path={PATH}
          onRun={vi.fn()}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("run-banner-archive"));
    expect(onArchive).toHaveBeenCalledWith({ launcher: LAUNCHERS[2] });
    cleanup();

    render(
      <MemoryRouter>
        <RunBanner status={STATUS} project="pavilio" path={PATH} onRun={onRun} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0].launcher).toEqual(LAUNCHERS[2]);
    await expectNoWorkspacePickWritten();
  });

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

  it("an edit to the objective is saved for this project and used for the send", async () => {
    const user = userEvent.setup();
    const onRun = renderBanner(vi.fn());

    await user.clear(objective());
    await user.type(objective(), "Only do task 7");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("claude '/goal Only do task 7'");
    // The one-send rule is withdrawn: the edit is this project's objective now.
    expect(readPreference(preferences.taskPromptOverride, "pavilio")).toBe("Only do task 7");
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
    writePreference(preferences.projectRunLauncher, "codex", "pavilio");
    const onRun = renderBanner(vi.fn());

    await user.click(screen.getByRole("button", { name: "Collapse run banner" }));

    expect(screen.queryByRole("textbox", { name: "Objective" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("12 of 17 left")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "via codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand run banner" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Still runnable from the single row, with the resolved default objective.
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith(
      `codex '/goal pavilio-execute-plan Implement all tasks in ${PATH}; done when every task is checked and tests + lint pass.'`,
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

    // Collapsing takes focus from the box, which saves the edit.
    await user.click(objective());
    fireEvent.change(objective(), { target: { value: "Kept across the fold" } });
    await user.click(screen.getByRole("button", { name: "Collapse run banner" }));
    await user.click(screen.getByRole("button", { name: "Expand run banner" }));

    expect(objective().value).toBe("Kept across the fold");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("claude '/goal Kept across the fold'");
  });

  it("Ctrl+Enter in the objective runs it", async () => {
    const user = userEvent.setup();
    const onRun = renderBanner(vi.fn());

    await user.click(objective());
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(objective().value).not.toContain("\n");
  });

  it("a run loop that takes no prompt disables the objective and says so", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "/continue" },
    ]);
    const onRun = renderBanner(vi.fn());

    expect(objective()).toBeDisabled();
    expect(screen.getByText("This launcher's run loop takes no prompt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run" }));
    // What is read is what is sent: the run loop alone, no objective.
    expect(onRun).toHaveBeenCalledWith("claude '/continue'");
  });

  it("a later placeholder in the run loop is drawn as the objective, not as raw text", () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "tool", command: "tool", runLoop: "{prompt} --title {prompt}" },
    ]);
    renderBanner();

    const after = screen.getByTestId("run-banner-wrapper-after").textContent;
    expect(after).toBe(" --title «objective»'");
    expect(after).not.toContain("{prompt}");
  });

  it("offers no run when no launcher has a run loop", () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "claude", command: "claude", runLoop: "" },
      { name: "mytool", command: "mytool" },
    ]);
    renderBanner();

    expect(screen.queryByRole("group", { name: "CLI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/no launcher has a run loop/i)).toBeInTheDocument();
  });

  it("a run loop with no prompt stays runnable when the template resolves to blank", async () => {
    const user = userEvent.setup();
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "/continue" },
    ]);
    writePreference(preferences.taskPromptDefault, "   ");
    const onRun = renderBanner(vi.fn());

    expect(objective().value.trim()).toBe("");
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledWith("claude '/continue'");
  });

  it("the footer offers no editing or shortcut while the objective is disabled", () => {
    writePreference(preferences.terminalLaunchers, [
      { name: "resume", command: "claude", runLoop: "/continue" },
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
    expect(foot).toContain("saved for this project");
    expect(foot).toContain("⌘↵");
  });
});

describe("RunBanner, done", () => {
  const DONE: TaskListStatus = { changeId: STATUS.changeId, total: 6, remaining: 0 };

  function renderDone(onRun = vi.fn()) {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    render(
      <MemoryRouter>
        <RunBanner
          status={DONE}
          project="pavilio"
          path={PATH}
          onRun={onRun}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    );
    return onRun;
  }

  it("the done banner shows a check, the count and a full green bar", () => {
    renderDone();

    const banner = screen.getByRole("status", { name: "Change done" });
    expect(within(banner).getByText("All 6 tasks done")).toBeInTheDocument();
    expect(within(banner).getByTestId("run-banner-done-icon")).toBeInTheDocument();
    const bar = within(banner).getByRole("progressbar", { name: "Tasks done" });
    expect(bar).toHaveAttribute("aria-valuenow", "6");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    expect(bar.querySelectorAll("[data-segment]")).toHaveLength(6);
    expect(bar.querySelectorAll('[data-segment="done"]')).toHaveLength(6);
    expect(screen.queryByRole("region", { name: "Run this change" })).toBeNull();
  });

  it("the done banner offers no run", () => {
    // Collapsed or not, the done banner is the same: the fold is not read.
    for (const expanded of [true, false]) {
      writePreference(preferences.plansBannerExpanded, expanded);
      const onRun = renderDone();

      expect(screen.getByText("All 6 tasks done")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Objective" })).toBeNull();
      expect(screen.queryByTestId("run-banner-chevron")).toBeNull();
      // What it does offer: the project's CLI and Archive.
      expect(screen.getByRole("link", { name: "via claude" })).toBeInTheDocument();
      expect(screen.getByTestId("run-banner-archive")).toHaveTextContent("Archive");
      expect(onRun).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("done banner explains a blocked launcher", () => {
    writeBlockedPick();
    render(
      <MemoryRouter>
        <RunBanner status={DONE} project="pavilio" path={PATH} onRun={vi.fn()} onArchive={vi.fn()} />
      </MemoryRouter>,
    );

    const archive = screen.getByTestId("run-banner-archive");
    expect(archive).toBeDisabled();
    // Visible, not only a hover title, and tied to the disabled button.
    const note = screen.getByTestId("run-banner-blocked");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(/whole command line/);
    expect(within(note).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/project/pavilio",
    );
    expect(archive).toHaveAttribute("aria-describedby", note.id);
    expect(archive).toHaveAccessibleDescription(/whole command line/);
  });

  it("a one-task change reads in the singular", () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    render(
      <MemoryRouter>
        <RunBanner
          status={{ changeId: STATUS.changeId, total: 1, remaining: 0 }}
          project="pavilio"
          path={PATH}
          onRun={vi.fn()}
        />
      </MemoryRouter>,
    );

    const banner = screen.getByRole("status", { name: "Change done" });
    expect(within(banner).getByText("All 1 task done")).toBeInTheDocument();
  });
});

describe("RunBanner, archive", () => {
  const DONE: TaskListStatus = { changeId: STATUS.changeId, total: 6, remaining: 0 };
  const TWO_LEFT: TaskListStatus = { changeId: STATUS.changeId, total: 6, remaining: 2 };
  const OTHER = "projects/pavilio/plans/openspec/changes/2026-10-01-other/tasks.md";

  function banner(status: TaskListStatus, path: string, onArchive: () => void) {
    return (
      <MemoryRouter>
        <RunBanner
          status={status}
          project="pavilio"
          path={path}
          onRun={vi.fn()}
          onArchive={onArchive}
        />
      </MemoryRouter>
    );
  }

  function renderArchive(status: TaskListStatus, onArchive = vi.fn()) {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const view = render(banner(status, PATH, onArchive));
    return { onArchive, rerender: (path: string) => view.rerender(banner(status, path, onArchive)) };
  }

  function archive(): HTMLElement {
    return screen.getByTestId("run-banner-archive");
  }

  it("shows Archive next to Run when expanded", () => {
    writePreference(preferences.plansBannerExpanded, true);
    renderArchive(STATUS);

    const run = screen.getByTestId("run-banner-run");
    expect(archive()).toHaveTextContent("Archive");
    expect(run.nextElementSibling).toBe(archive());
  });

  it("shows Archive next to Run when collapsed", () => {
    writePreference(preferences.plansBannerExpanded, false);
    renderArchive(STATUS);

    expect(screen.getByRole("button", { name: "Expand run banner" })).toBeInTheDocument();
    const run = screen.getByTestId("run-banner-run");
    expect(run.nextElementSibling).toBe(archive());
  });

  it("archives on one click when every task is checked", () => {
    const { onArchive } = renderArchive(DONE);

    fireEvent.click(archive());

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({ launcher: LAUNCHERS[0] });
  });

  it("asks for a second click when tasks are unchecked", () => {
    vi.useFakeTimers();
    const { onArchive } = renderArchive(TWO_LEFT);

    fireEvent.click(archive());
    expect(archive()).toHaveTextContent("Archive with 2 unchecked? Confirm");
    expect(onArchive).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.click(archive());
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({ launcher: LAUNCHERS[0] });
  });

  it("disarms after 4 seconds", () => {
    vi.useFakeTimers();
    const { onArchive } = renderArchive(TWO_LEFT);

    fireEvent.click(archive());
    act(() => vi.advanceTimersByTime(4_000));
    expect(archive().textContent).toBe("Archive");

    // A later single click only arms again.
    fireEvent.click(archive());
    expect(archive()).toHaveTextContent("Archive with 2 unchecked? Confirm");
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("disarms when another file is opened", () => {
    vi.useFakeTimers();
    const { onArchive, rerender } = renderArchive(TWO_LEFT);

    fireEvent.click(archive());
    rerender(OTHER);
    expect(archive().textContent).toBe("Archive");

    fireEvent.click(archive());
    expect(archive()).toHaveTextContent("Archive with 2 unchecked? Confirm");
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("disables Archive for a blocked launcher", () => {
    writeBlockedPick();
    const onArchive = vi.fn();
    render(banner(TWO_LEFT, PATH, onArchive));

    expect(archive()).toBeDisabled();
    expect(archive()).toHaveAttribute("title", screen.getByTestId("run-banner-run").title);
    expect(archive().title).toMatch(/whole command line/);
    fireEvent.click(archive());
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("collapsed banner explains a blocked launcher", () => {
    writeBlockedPick();
    writePreference(preferences.plansBannerExpanded, false);
    render(banner(TWO_LEFT, PATH, vi.fn()));

    expect(screen.getByRole("button", { name: "Expand run banner" })).toBeInTheDocument();
    // Visible without expanding, and tied to both disabled buttons.
    const note = screen.getByTestId("run-banner-blocked");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(/whole command line/);
    expect(within(note).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/project/pavilio",
    );
    const run = screen.getByTestId("run-banner-run");
    expect(run).toBeDisabled();
    expect(archive()).toBeDisabled();
    expect(run).toHaveAttribute("aria-describedby", note.id);
    expect(archive()).toHaveAttribute("aria-describedby", note.id);
    expect(run).toHaveAccessibleDescription(/whole command line/);
    expect(archive()).toHaveAccessibleDescription(/whole command line/);
  });

  it("expanded banner draws a blocked launcher's note once", () => {
    writeBlockedPick();
    writePreference(preferences.plansBannerExpanded, true);
    render(banner(TWO_LEFT, PATH, vi.fn()));

    const notes = screen.getAllByTestId("run-banner-blocked");
    expect(notes).toHaveLength(1);
    expect(archive()).toHaveAttribute("aria-describedby", notes[0].id);
    expect(screen.getByTestId("run-banner-run")).toHaveAttribute("aria-describedby", notes[0].id);
  });

  /** A launch that stays pending until the test settles it. */
  function pending() {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it("disables Run while an archive is starting", async () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const launch = pending();
    const onRun = vi.fn();
    render(
      <MemoryRouter>
        <RunBanner
          status={TWO_LEFT}
          project="pavilio"
          path={PATH}
          onRun={onRun}
          onArchive={() => launch.promise}
        />
      </MemoryRouter>,
    );
    const run = screen.getByTestId("run-banner-run");

    fireEvent.click(archive());
    fireEvent.click(archive());
    expect(run).toBeDisabled();
    expect(archive()).toBeDisabled();
    fireEvent.click(run);
    expect(onRun).not.toHaveBeenCalled();

    await act(async () => launch.settle());
    expect(run).toBeEnabled();
    expect(archive()).toBeEnabled();
  });

  it("disables Archive while a run is starting", async () => {
    writePreference(preferences.terminalLaunchers, LAUNCHERS);
    const launch = pending();
    const onArchive = vi.fn();
    render(
      <MemoryRouter>
        <RunBanner
          status={TWO_LEFT}
          project="pavilio"
          path={PATH}
          onRun={() => launch.promise}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    );
    const run = screen.getByTestId("run-banner-run");

    fireEvent.click(run);
    expect(run).toBeDisabled();
    expect(archive()).toBeDisabled();
    fireEvent.click(archive());
    fireEvent.click(archive());
    expect(onArchive).not.toHaveBeenCalled();

    await act(async () => launch.settle());
    expect(run).toBeEnabled();
    expect(archive()).toBeEnabled();
  });
});
