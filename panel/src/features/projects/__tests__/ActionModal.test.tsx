import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const proj = (name: string) => ({
  name,
  path: `/tmp/${name}`,
  hasIndex: false,
  hasNotes: false,
  hasProgress: false,
  hasPlans: false,
  hasWiki: false,
  latestProgressDate: null,
  kind: "project",
  lastActivity: null,
  repos: [],
  group: null,
});
let PROJECTS = [proj("metro"), proj("workspace")];
vi.mock("../useProjects", () => ({ useProjects: () => PROJECTS }));

import { ActionModal } from "../ActionModal";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  clearPreference,
  readPreference,
  writePreference,
} from "../../../preferences/store";

const SEED = [
  { label: "Harvest", runner: "claude", text: "do-harvest", project: "workspace" },
  { label: "Pull", runner: "shell", text: "git pull", project: "metro" },
];

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const stored = () => readPreference(preferences.homeActions);

describe("ActionModal", () => {
  beforeEach(() => {
    PROJECTS = [proj("metro"), proj("workspace")];
    __resetPreferenceStoreForTests();
    writePreference(preferences.homeActions, SEED);
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("Delete's base border is a class, so its hover border is not shadowed by an inline style", () => {
    render(<ActionModal index={0} onClose={() => {}} />);
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del.style.borderColor).toBe("");
    expect(del.className).toContain("border-[#5a2a2a]");
    expect(del.className).toContain("hover:border-[#8a3a3a]");
  });

  it("edit opens filled with Delete", () => {
    render(<ActionModal index={0} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Edit action" })).toBeTruthy();
    expect(field("Label").value).toBe("Harvest");
    expect(field("Prompt").value).toBe("do-harvest");
    expect((field("Project") as unknown as HTMLSelectElement).value).toBe("workspace");
    const group = screen.getByRole("group", { name: "Runs with" });
    const names = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["claude", "codex", "opencode", "shell"]);
    expect(screen.getByRole("button", { name: "claude" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("action-modal-hint")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    // 390px: the modal never outgrows the viewport.
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("max-w-[min(440px,calc(100vw-32px))]");
  });

  it("uses readable text and hover/focus styles (no muted-on-elevated, no inert buttons)", () => {
    render(<ActionModal index={0} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    for (const l of Array.from(dialog.querySelectorAll("label"))) {
      expect(l.className).toContain("text-sm");
      expect(l.getAttribute("style") ?? "").not.toContain("--text-muted");
    }
    const ids = ["action-modal-save", "action-modal-delete", "action-modal-cancel", "action-modal-runner-claude", "action-modal-runner-codex"];
    for (const id of ids) {
      const b = screen.getByTestId(id);
      expect(b.className).toMatch(/hover:bg-/);
      expect(b.className).toContain("focus-visible:");
      expect(b.getAttribute("style") ?? "").not.toContain("--text-muted");
    }
    // The hint keeps its original muted 12px look.
    const hint = screen.getByTestId("action-modal-hint");
    expect(hint.className).toContain("text-[12px]");
    expect(hint.getAttribute("style")).toContain("--text-muted");
  });

  it("shell runner relabels the field Command", () => {
    render(<ActionModal index={0} onClose={() => {}} />);
    expect(screen.queryByLabelText("Command")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "shell" }));
    expect(field("Command")).toBeTruthy();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
    // Editing a stored shell action opens with Command already.
    cleanup();
    render(<ActionModal index={1} onClose={() => {}} />);
    expect(field("Command").value).toBe("git pull");
  });

  it("new opens empty with defaults and no Delete", () => {
    render(<ActionModal index={null} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "New action" })).toBeTruthy();
    expect(field("Label").value).toBe("");
    expect(field("Prompt").value).toBe("");
    expect(screen.getByRole("button", { name: "claude" }).getAttribute("aria-pressed")).toBe("true");
    expect((field("Project") as unknown as HTMLSelectElement).value).toBe("workspace");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("save is disabled until required fields are filled", () => {
    render(<ActionModal index={null} onClose={() => {}} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field("Label"), { target: { value: "X" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field("Prompt"), { target: { value: "  " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field("Prompt"), { target: { value: "go" } });
    expect(save.disabled).toBe(false);
    fireEvent.change(field("Label"), { target: { value: "" } });
    expect(save.disabled).toBe(true);
  });

  it("save edits in place; save from new appends", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ActionModal index={0} onClose={onClose} />);
    fireEvent.change(field("Label"), { target: { value: "Harvest 2" } });
    fireEvent.click(screen.getByRole("button", { name: "codex" }));
    fireEvent.change(field("Project"), { target: { value: "metro" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toEqual([
      { label: "Harvest 2", runner: "codex", text: "do-harvest", project: "metro" },
      SEED[1],
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(<ActionModal index={null} onClose={onClose} />);
    fireEvent.change(field("Label"), { target: { value: "New one" } });
    fireEvent.change(field("Prompt"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toHaveLength(3);
    expect(stored()[2]).toEqual({
      label: "New one",
      runner: "claude",
      text: "hello",
      project: "workspace",
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("writes the full list when home.actions was never stored", () => {
    clearPreference(preferences.homeActions);
    const onClose = vi.fn();
    render(<ActionModal index={1} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(stored()).toHaveLength(1);
    expect(stored()[0].label).toBe("Process meetings");
  });

  it("delete removes and closes", () => {
    const onClose = vi.fn();
    render(<ActionModal index={0} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(stored()).toEqual([SEED[1]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel, Esc and backdrop write nothing", () => {
    const onClose = vi.fn();
    render(<ActionModal index={0} onClose={onClose} />);
    fireEvent.change(field("Label"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("action-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(3);
    // A click inside the dialog does not close it.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(stored()).toEqual(SEED);
  });

  it("new action picks up a project list that loads after it opened", () => {
    PROJECTS = [];
    const { rerender } = render(<ActionModal index={null} onClose={() => {}} />);
    expect((field("Project") as unknown as HTMLSelectElement).value).toBe("");
    fireEvent.change(field("Label"), { target: { value: "X" } });
    fireEvent.change(field("Prompt"), { target: { value: "go" } });
    // An empty Project keeps Save disabled.
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    PROJECTS = [proj("metro"), proj("workspace")];
    rerender(<ActionModal index={null} onClose={() => {}} />);
    expect((field("Project") as unknown as HTMLSelectElement).value).toBe("workspace");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a project the user picked survives the list loading", () => {
    PROJECTS = [proj("metro")];
    const { rerender } = render(<ActionModal index={null} onClose={() => {}} />);
    fireEvent.change(field("Project"), { target: { value: "metro" } });
    PROJECTS = [proj("workspace"), proj("metro")];
    rerender(<ActionModal index={null} onClose={() => {}} />);
    expect((field("Project") as unknown as HTMLSelectElement).value).toBe("metro");
  });

  it("save and delete follow the edited action when the list is reordered", () => {
    const { unmount } = render(<ActionModal index={0} onClose={() => {}} />);
    act(() => writePreference(preferences.homeActions, [SEED[1], SEED[0]]));
    fireEvent.change(field("Label"), { target: { value: "Harvest 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toEqual([SEED[1], { ...SEED[0], label: "Harvest 2" }]);
    unmount();

    writePreference(preferences.homeActions, SEED);
    render(<ActionModal index={0} onClose={() => {}} />);
    act(() => writePreference(preferences.homeActions, [SEED[1], SEED[0]]));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(stored()).toEqual([SEED[1]]);
  });

  it("editing the second of two identical actions edits that one", () => {
    writePreference(preferences.homeActions, [SEED[0], SEED[0]]);
    render(<ActionModal index={1} onClose={() => {}} />);
    fireEvent.change(field("Label"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toEqual([SEED[0], { ...SEED[0], label: "Renamed" }]);
  });

  it("closes without writing when the edited action is gone", () => {
    const onClose = vi.fn();
    render(<ActionModal index={0} onClose={onClose} />);
    act(() => writePreference(preferences.homeActions, [SEED[1]]));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toEqual([SEED[1]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an identical twin makes the edited slot ambiguous", () => {
    writePreference(preferences.homeActions, [SEED[0], SEED[0]]);
    const onClose = vi.fn();
    render(<ActionModal index={1} onClose={onClose} />);
    // Another tab deletes the 2nd entry; the survivor is indistinguishable.
    act(() => writePreference(preferences.homeActions, [SEED[0]]));
    fireEvent.change(field("Label"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toEqual([SEED[0]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fails closed on Save and Delete when [A, A] shrinks to [A] under index 0", () => {
    for (const name of ["Save", "Delete"]) {
      writePreference(preferences.homeActions, [SEED[0], SEED[0]]);
      const onClose = vi.fn();
      const { unmount } = render(<ActionModal index={0} onClose={onClose} />);
      // Another tab removes the first entry; actions[0] still equals the original.
      act(() => writePreference(preferences.homeActions, [SEED[0]]));
      fireEvent.change(field("Label"), { target: { value: "Renamed" } });
      fireEvent.click(screen.getByRole("button", { name }));
      expect(stored()).toEqual([SEED[0]]);
      expect(onClose).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("fails closed on delete when several matches remain", () => {
    writePreference(preferences.homeActions, [SEED[0], SEED[0], SEED[0]]);
    render(<ActionModal index={2} onClose={() => {}} />);
    act(() => writePreference(preferences.homeActions, [SEED[0], SEED[0], SEED[1]]));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(stored()).toEqual([SEED[0], SEED[0], SEED[1]]);
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    render(<ActionModal index={0} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>("input, select, button:not([disabled])"),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps a stored runner that is no longer a launcher pressed", () => {
    writePreference(preferences.homeActions, [
      { label: "Old", runner: "gemini", text: "x", project: "metro" },
    ]);
    render(<ActionModal index={0} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "gemini" }).getAttribute("aria-pressed")).toBe("true");
  });
});
