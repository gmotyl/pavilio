import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { VoiceSelect } from "../VoiceSelect";
import {
  DEFAULT_SPEECH_VOICE,
  SPEECH_VOICES,
  SPEECH_VOICE_STORAGE_KEY,
  getStoredVoice,
} from "../voices";
import AgentSettings from "../../agents/AgentSettings";
import LeftSidebar from "../../shell/LeftSidebar";
import { Breadcrumbs as ShellBreadcrumbs } from "../../shell/Breadcrumbs";
import LegacyBreadcrumbs from "../../../components/Breadcrumbs";

/**
 * LeftSidebar pulls in the whole project/terminal/git data layer; the sidebar
 * assertion here only cares about one label, so those hooks are stubbed the
 * same way `features/shell/__tests__/LeftSidebar.lastTab.test.tsx` does it.
 */
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [],
}));
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
}));
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: () => {},
    favorites: [],
  }),
}));
vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({ sessions: [], refresh: () => {} }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({ enabled: false }),
}));
vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: null }),
}));
vi.mock("../../git/useGitStatus", () => ({
  useGitStatus: () => ({ files: [], suggestion: "", refetch: () => {} }),
}));

const VOICE_LABEL = "Speech voice";

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

function voiceSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: VOICE_LABEL }) as HTMLSelectElement;
}

describe("VoiceSelect", () => {
  it("lists the multilingual voices and marks the stored one selected", () => {
    localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, "de-DE-SeraphinaMultilingualNeural");

    render(<VoiceSelect />);

    const select = voiceSelect();
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];

    // The picker is `voices.ts` verbatim — same ids, same order, no extras.
    expect(options.map((option) => option.value)).toEqual(
      SPEECH_VOICES.map((voice) => voice.id),
    );
    expect(options.map((option) => option.textContent)).toEqual(
      SPEECH_VOICES.map((voice) => voice.label),
    );

    // Multilingual-only: a single-language voice on this page would let a
    // Polish voice be handed an English answer.
    for (const option of options) expect(option.value).toContain("Multilingual");
    expect(options.map((option) => option.value)).not.toContain("pl-PL-MarekNeural");
    expect(options.map((option) => option.value)).not.toContain("pl-PL-ZofiaNeural");

    // Selected state read off the accessible option, not a class name.
    const stored = options.find(
      (option) => option.value === "de-DE-SeraphinaMultilingualNeural",
    );
    expect(stored?.selected).toBe(true);
    expect(options.filter((option) => option.selected)).toHaveLength(1);
    expect(select).toHaveValue("de-DE-SeraphinaMultilingualNeural");
  });

  it("persists the selection under panel-speech-voice", async () => {
    const user = userEvent.setup();

    render(<VoiceSelect />);

    const select = voiceSelect();
    expect(select).toHaveValue(DEFAULT_SPEECH_VOICE);

    await user.selectOptions(select, "fr-FR-VivienneMultilingualNeural");

    expect(localStorage.getItem(SPEECH_VOICE_STORAGE_KEY)).toBe(
      "fr-FR-VivienneMultilingualNeural",
    );
    // What the player reads on every play() — the pick is live for synthesis.
    expect(getStoredVoice()).toBe("fr-FR-VivienneMultilingualNeural");
    expect(select).toHaveValue("fr-FR-VivienneMultilingualNeural");
  });

  it("keeps the pick for this page view when storage throws", async () => {
    const user = userEvent.setup();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });

    render(<VoiceSelect />);

    const select = voiceSelect();
    await expect(
      user.selectOptions(select, "it-IT-GiuseppeMultilingualNeural"),
    ).resolves.not.toThrow();

    // Blocked site data must not strand the control on the old voice.
    expect(select).toHaveValue("it-IT-GiuseppeMultilingualNeural");
    // Nothing was persisted, so a reload falls back to the default — that is
    // the documented consequence, not a crash.
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
  });

  it("labels the page, sidebar entry and breadcrumb Settings", async () => {
    stubEmptyAgentSettingsApi();

    const page = render(<AgentSettings />);
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByText("Agent Settings")).not.toBeInTheDocument();
    // The page is where the voice picker lives — one global preference.
    expect(voiceSelect()).toBeInTheDocument();
    page.unmount();

    const sidebar = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <LeftSidebar />
      </MemoryRouter>,
    );
    // The test id is part of the contract and must survive the relabelling.
    const entry = screen.getByTestId("sidebar-agent-settings");
    expect(entry).toHaveTextContent("Settings");
    expect(entry).not.toHaveTextContent("Agent Settings");
    sidebar.unmount();

    // Both breadcrumb copies carry the label; only changing one leaves the
    // panel inconsistent depending on which module renders.
    const shell = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <ShellBreadcrumbs />
      </MemoryRouter>,
    );
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Settings"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Agent Settings")).not.toBeInTheDocument();
    shell.unmount();

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <LegacyBreadcrumbs />
      </MemoryRouter>,
    );
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Agent Settings")).not.toBeInTheDocument();
  });
});
