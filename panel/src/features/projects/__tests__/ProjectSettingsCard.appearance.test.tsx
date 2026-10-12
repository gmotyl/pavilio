import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import ProjectSettingsCard from "../ProjectSettingsCard";
import { ProjectColorPicker } from "../../terminal/ProjectColorPicker";
import { installProjectColors, rgb } from "../../terminal/__tests__/projectColors.harness";

vi.mock("../../speech/ProjectVoiceSelect", () => ({ ProjectVoiceSelect: () => null }));

beforeEach(() => installProjectColors());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const unfold = () => fireEvent.click(screen.getByRole("button", { name: "Change appearance" }));
const row = () => screen.getByTestId("appearance-row");

describe("ProjectSettingsCard appearance", () => {
  it("Appearance row is collapsed by default with chip and button", () => {
    render(<ProjectSettingsCard project="alpha" />);
    expect(within(row()).getByTestId("project-mark")).toBeTruthy();
    expect(within(row()).getByText("alpha")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#f0c674");
    expect(screen.getByRole("button", { name: "Change appearance" })).toBeTruthy();
    expect(screen.queryByTestId("project-color-picker")).toBeNull();
    expect(screen.queryByLabelText("Custom hex")).toBeNull();
  });

  it("Change appearance unfolds palette, hex field and Icon/Emoji tabs", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    expect(screen.getByTestId("project-color-picker")).toBeTruthy();
    expect(screen.getByLabelText("Custom hex")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Icon" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Emoji" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Image" })).toBeNull();
  });

  it("icon tab offers 23 icons and highlights the chosen one", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    const grid = screen.getByTestId("appearance-icons");
    expect(within(grid).getAllByRole("button")).toHaveLength(23);
    expect(screen.getByTestId("appearance-icon-folder").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    expect(screen.getByTestId("appearance-icon-rocket").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("appearance-icon-folder").getAttribute("aria-pressed")).toBe("false");
  });

  it("picking previews live; Apply saves and folds; Cancel discards", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    expect(within(row()).getByTestId("project-mark-icon-rocket")).toBeTruthy();
    expect(within(row()).getByTestId("project-mark").style.color).toBe(rgb("#61afef"));
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#f0c674");

    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-rocket")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#61afef");
  });

  it("emoji tab rejects non-single-emoji input", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    const input = screen.getByLabelText("Emoji");
    for (const bad of ["ab", "🚀🚀", ""]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Use emoji" }));
      expect(screen.getByRole("alert").textContent).toMatch(/exactly one emoji/i);
      expect(within(row()).queryByText("ab")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.change(screen.getByLabelText("Emoji"), { target: { value: "🚀" } });
    fireEvent.click(screen.getByRole("button", { name: "Use emoji" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(row()).getByTestId("project-mark").textContent).toBe("🚀");
  });

  it("Escape while unfolded discards the draft and folds", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.keyDown(screen.getByTestId("appearance-body"), { key: "Escape" });
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
  });

  it("an emoji mark highlights no icon and prefills the Emoji field", () => {
    writePreference(preferences.projectMark, "emoji:🚀", "alpha");
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    const pressed = within(screen.getByTestId("appearance-icons"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    expect((screen.getByLabelText("Emoji") as HTMLInputElement).value).toBe("🚀");
  });

  it("Apply with an emoji mark persists emoji:🚀", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.change(screen.getByLabelText("Emoji"), { target: { value: "🚀" } });
    fireEvent.click(screen.getByRole("button", { name: "Use emoji" }));
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(readPreference(preferences.projectMark, "alpha")).toBe("emoji:🚀");
  });

  it("typing a hex only stages a draft; Apply then saves it", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.change(screen.getByLabelText("Custom hex"), { target: { value: "#123456" } });
    fireEvent.keyDown(screen.getByLabelText("Custom hex"), { key: "Enter" });
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#123456");
    expect(readPreference(preferences.projectColor, "alpha")).toBe("#f0c674");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(readPreference(preferences.projectColor, "alpha")).toBe("#123456");
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#123456");
  });

  it("a colour held by another project still names that project", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    expect(screen.getByTestId("project-color-preset-alpha-coral").getAttribute("title")).toMatch(/used by beta/);
  });

  it("terminal grid popover picker is unchanged", () => {
    render(<ProjectColorPicker project="alpha" testId="trigger" />);
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Set colour for alpha" })).toBeTruthy();
  });
});
