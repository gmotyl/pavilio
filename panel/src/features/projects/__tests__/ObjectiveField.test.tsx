import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RunBanner } from "../RunBanner";
import type { TaskListStatus } from "../taskList";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import { writeOverride } from "../../../preferences/overridable";
import { storageKey } from "../../../preferences/types";

/**
 * The banner's objective box as a saved, per-project field: resolved text
 * while idle, the template with marked placeholders while focused, saved on
 * blur (or by a Run that happens while it is still focused).
 *
 * Rendered inside the real banner, because the save-before-Run rule is a
 * contract between the two.
 */

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const STATUS: TaskListStatus = {
  changeId: "2026-09-30-demo",
  total: 4,
  remaining: 3,
};
const PATH = "projects/pavilio/plans/openspec/changes/2026-09-30-demo/tasks.md";
const LAUNCHERS: TerminalLauncher[] = [
  { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
];
const TEMPLATE = "pavilio-execute-plan Implement all tasks in {path} for {project}";
const RESOLVED = `pavilio-execute-plan Implement all tasks in ${PATH} for pavilio`;

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

function renderBanner(onRun: (runLine: string) => void = vi.fn()) {
  render(<RunBanner status={STATUS} project="pavilio" path={PATH} onRun={onRun} />);
  return onRun;
}

function objective(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Objective" }) as HTMLTextAreaElement;
}

function override(project = "pavilio"): string | null {
  return readPreference(preferences.taskPromptOverride, project);
}

describe("ObjectiveField", () => {
  it("idle shows the resolved objective", () => {
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    renderBanner();

    expect(objective().value).toBe(RESOLVED);
    // Nothing is tinted while the box shows what will be sent.
    expect(screen.queryByTestId("objective-overlay")).not.toBeInTheDocument();
  });

  it("focus shows the template with marked placeholders", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, "Do {change} at {path} in {project}.");
    renderBanner();

    await user.click(objective());

    expect(objective().value).toBe("Do {change} at {path} in {project}.");
    const overlay = screen.getByTestId("objective-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay.textContent).toBe("Do {change} at {path} in {project}.");
    const marked = Array.from(overlay.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marked).toEqual(["{change}", "{path}", "{project}"]);
  });

  it("blur stores the edit as this project's objective", async () => {
    const user = userEvent.setup();
    writeOverride(preferences.taskPromptOverride, "other's own", "other");
    renderBanner();

    await user.click(objective());
    await user.clear(objective());
    // `{{` is userEvent's escape for a literal brace.
    await user.type(objective(), "Only {{change}");
    await user.tab();

    expect(override()).toBe("Only {change}");
    expect(override("other")).toBe("other's own");
    // Blurred: back to the resolved text of what was saved.
    expect(objective().value).toBe("Only 2026-09-30-demo");
  });

  it("the workspace default or an empty box clears the override", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    writeOverride(preferences.taskPromptOverride, "project text", "pavilio");
    renderBanner();

    // Typed back to exactly the workspace default: cleared, not stored.
    await user.click(objective());
    fireEvent.change(objective(), { target: { value: TEMPLATE } });
    await user.tab();
    expect(
      storageKey(preferences.taskPromptOverride, "pavilio") in globals.__PAVILIO_PREFS__!,
    ).toBe(false);
    expect(objective().value).toBe(RESOLVED);

    // An emptied box: cleared too, and the workspace default shows resolved.
    act(() => writeOverride(preferences.taskPromptOverride, "again", "pavilio"));
    await user.click(objective());
    await user.clear(objective());
    await user.tab();
    expect(override()).toBeNull();
    expect(objective().value).toBe(RESOLVED);
  });

  it("the override marker resets to the workspace default", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    renderBanner();

    expect(screen.queryByText(/project objective/)).not.toBeInTheDocument();
    act(() => writeOverride(preferences.taskPromptOverride, "Mine", "pavilio"));
    expect(screen.getByTestId("objective-override-marker").textContent).toBe(
      "project objective · reset to workspace default",
    );

    await user.click(screen.getByTestId("objective-reset"));

    expect(override()).toBeNull();
    expect(screen.queryByTestId("objective-override-marker")).not.toBeInTheDocument();
    expect(objective().value).toBe(RESOLVED);
  });

  it("Run while editing saves first", async () => {
    const onRun = renderBanner(vi.fn());

    // Focused and edited, and Run pressed without the field losing focus
    // first: a keyboard shortcut, or a click whose blur has not landed.
    objective().focus();
    fireEvent.change(objective(), { target: { value: "Just {change}" } });
    fireEvent.keyDown(objective(), { key: "Enter", ctrlKey: true });

    expect(override()).toBe("Just {change}");
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("claude '/goal Just 2026-09-30-demo'");

    // The Run button with the box still focused does the same.
    fireEvent.change(objective(), { target: { value: "Then {project}" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(override()).toBe("Then {project}");
    expect(onRun).toHaveBeenLastCalledWith("claude '/goal Then pavilio'");
  });

  it("copy takes the resolved text", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Copy objective" }));
    expect(writeText).toHaveBeenLastCalledWith(RESOLVED);
    expect(await screen.findByText("copied")).toBeInTheDocument();

    // Focused, showing the template: still the resolved text of the draft.
    await user.click(objective());
    await user.type(objective(), " now");
    await user.click(screen.getByTestId("objective-copy"));
    expect(writeText).toHaveBeenLastCalledWith(`${RESOLVED} now`);
    // The press did not take focus from the field.
    expect(objective()).toHaveFocus();

    // A failing clipboard is survived.
    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByTestId("objective-copy"));
    expect(objective()).toBeInTheDocument();
  });

  it("an edit is saved to the project it was made in", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    writeOverride(preferences.taskPromptOverride, "b's own {project}", "b");
    const { rerender } = render(
      <RunBanner status={STATUS} project="a" path={PATH} onRun={vi.fn()} />,
    );

    await user.click(objective());
    await user.clear(objective());
    await user.type(objective(), "a's edit");
    // The tab moves on to project b (back/forward, a programmatic navigate)
    // while the box still has focus.
    rerender(<RunBanner status={STATUS} project="b" path={PATH} onRun={vi.fn()} />);
    // The draft does not travel: the box is b's template, still focused.
    expect(objective()).toHaveFocus();
    expect(objective().value).toBe("b's own {project}");
    await user.tab();

    expect(override("a")).toBe("a's edit");
    expect(override("b")).toBe("b's own {project}");
    expect(objective().value).toBe("b's own b");
  });

  it("an unedited focus follows a project switch", async () => {
    const user = userEvent.setup();
    writePreference(preferences.taskPromptDefault, TEMPLATE);
    writeOverride(preferences.taskPromptOverride, "b's own", "b");
    const { rerender } = render(
      <RunBanner status={STATUS} project="a" path={PATH} onRun={vi.fn()} />,
    );

    await user.click(objective());
    rerender(<RunBanner status={STATUS} project="b" path={PATH} onRun={vi.fn()} />);
    expect(objective().value).toBe("b's own");
    await user.type(objective(), " more");
    await user.tab();

    expect(override("a")).toBeNull();
    expect(override("b")).toBe("b's own more");
  });

  it("unmounting while focused saves the pending edit", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <RunBanner status={STATUS} project="pavilio" path={PATH} onRun={vi.fn()} />,
    );

    await user.click(objective());
    await user.clear(objective());
    await user.type(objective(), "left mid-edit");
    unmount();

    expect(override()).toBe("left mid-edit");
  });

  it("clicking into the objective puts the caret where it was clicked", () => {
    const template = "Do {change} at {path} in {project}.";
    writePreference(preferences.taskPromptDefault, template);
    renderBanner();
    const resolved = objective().value;

    // Where a click lands on the idle, resolved text, then focus arrives and
    // the value swaps to the template.
    const clickAt = (start: number, end = start) => {
      act(() => objective().blur());
      objective().setSelectionRange(start, end);
      act(() => objective().focus());
      expect(objective().value).toBe(template);
      return [objective().selectionStart, objective().selectionEnd];
    };

    // In literal text: shifted by what the placeholders before it expanded to.
    const at = resolved.indexOf(" at ") + 2;
    expect(clickAt(at)).toEqual([template.indexOf(" at ") + 2, template.indexOf(" at ") + 2]);
    // Inside a placeholder's value: the end of its token.
    const inPath = resolved.indexOf(PATH) + 5;
    const afterPath = template.indexOf("{path}") + "{path}".length;
    expect(clickAt(inPath)).toEqual([afterPath, afterPath]);
    // Right before a value: before its token.
    expect(clickAt(3)).toEqual([3, 3]);
    // A range maps both ends; the very end stays the end.
    expect(clickAt(0, resolved.length)).toEqual([0, template.length]);
  });

  it("an unchanged blur writes nothing", async () => {
    const user = userEvent.setup();
    renderBanner();
    const before = structuredClone(globals.__PAVILIO_PREFS__);

    await user.click(objective());
    await user.tab();

    expect(globals.__PAVILIO_PREFS__).toEqual(before);
    expect(override()).toBeNull();
  });
});
