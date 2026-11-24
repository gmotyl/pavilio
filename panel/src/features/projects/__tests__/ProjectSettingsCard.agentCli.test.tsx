import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import ProjectSettingsCard from "../ProjectSettingsCard";

vi.mock("../../speech/ProjectVoiceSelect", () => ({
  ProjectVoiceSelect: () => <div data-testid="project-voice-stub">Speech voice</div>,
}));

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** `shell` has a blank run loop, so it is never offered. */
const LAUNCHERS: TerminalLauncher[] = [
  { name: "shell", command: "bash", runLoop: "" },
  { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
  { name: "codex", command: "codex", runLoop: "/goal {prompt}" },
  { name: "opencode", command: "opencode", runLoop: "{prompt}", promptFlag: "--prompt" },
];

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
  );
  writePreference(preferences.terminalLaunchers, LAUNCHERS);
});

afterEach(() => {
  cleanup();
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

const row = () => screen.getByTestId("project-settings-agent-cli-row");
const buttons = () => within(row()).getAllByRole("button");
const pressed = () =>
  buttons()
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

describe("ProjectSettingsCard Agent CLI", () => {
  it("renders the Agent CLI row after Speech voice", () => {
    render(<ProjectSettingsCard project="alpha" />);
    const voice = screen.getByTestId("project-voice-stub");
    expect(
      voice.compareDocumentPosition(row()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Before the opacity row: it sits right after Speech voice.
    expect(
      row().compareDocumentPosition(screen.getByTestId("project-settings-answer-opacity-row")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(row()).getByText("Agent CLI")).toBeTruthy();
    expect(within(row()).getByRole("group", { name: "Agent CLI" })).toBeTruthy();
    for (const b of buttons()) expect(b.hasAttribute("aria-pressed")).toBe(true);
    expect(
      within(row()).getByText(
        "Which CLI this project's runs start: Run and Archive on a change, and Explain on a PR.",
      ),
    ).toBeTruthy();
  });

  it("offers only launchers with a run loop", () => {
    render(<ProjectSettingsCard project="alpha" />);
    expect(buttons().map((b) => b.textContent)).toEqual(["claude", "codex", "opencode"]);
  });

  it("shows overrides default only when the project pick is set", () => {
    writePreference(preferences.plansRunLauncher, "codex");
    const { unmount } = render(<ProjectSettingsCard project="alpha" />);
    expect(within(row()).queryByText("overrides default")).toBeNull();
    expect(pressed()).toEqual(["codex"]);
    unmount();

    writePreference(preferences.projectRunLauncher, "opencode", "alpha");
    render(<ProjectSettingsCard project="alpha" />);
    expect(within(row()).getByText("overrides default")).toBeTruthy();
    expect(pressed()).toEqual(["opencode"]);
  });

  it("clicking a launcher saves it for this project", () => {
    render(<ProjectSettingsCard project="alpha" />);
    fireEvent.click(within(row()).getByRole("button", { name: "opencode" }));
    expect(readPreference(preferences.projectRunLauncher, "alpha")).toBe("opencode");
    expect(readPreference(preferences.projectRunLauncher, "beta")).toBeNull();
    expect(pressed()).toEqual(["opencode"]);
    expect(within(row()).getByText("overrides default")).toBeTruthy();
  });
});
