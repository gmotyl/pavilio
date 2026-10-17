import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { VoiceSelect } from "../VoiceSelect";
import { listEngines, listVoices, type VoiceInfo } from "anytts";
import { groupVoices } from "../voiceGroups";
import { DEFAULT_SPEECH_VOICE, getStoredVoice, setStoredVoice } from "../voices";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { readPreference } from "../../../preferences/store";
import AgentSettings from "../../agents/AgentSettings";
import LeftSidebar from "../../shell/LeftSidebar";
import { SpeechHostProvider } from "../SpeechHostProvider";
import { Breadcrumbs as ShellBreadcrumbs } from "../../shell/Breadcrumbs";

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
  useGitStatus: () => ({ files: [], refetch: () => {} }),
}));

/**
 * The sidebar's project rows read the speech host through `ProjectActivityLed`,
 * which throws without a `SpeechHostProvider` above it. This suite's
 * `useProjects` mock happens to return no projects, so no such row mounts and
 * an unwrapped render used to pass — a trap: adding one project here would have
 * made an unrelated suite throw. So the provider is mounted for real, with only
 * the HOST stubbed inert, the same way the LeftSidebar suites do it.
 */
vi.mock("../useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  return {
    useSpeechHost: () => INERT_SPEECH_HOST,
    default: () => INERT_SPEECH_HOST,
  };
});

/**
 * anytts ships one engine, so switching needs a second: this one is listed
 * beside edge with a two-voice catalog, configured by the seam, and the seam
 * resolves its default. A second extra engine is listed by anytts but NOT
 * configured, so the picker must leave it out.
 */
const { FAKE_ENGINE, UNCONFIGURED_ENGINE, FAKE_DEFAULT, FAKE_VOICES } = vi.hoisted(() => {
  const FAKE_DEFAULT = "xx-XX-FakeOneNeural";
  const FAKE_VOICES: VoiceInfo[] = [
    { id: FAKE_DEFAULT, label: "Fake One", locale: "xx-XX", gender: "female", multilingual: true },
    { id: "xx-XX-FakeTwoNeural", label: "Fake Two", locale: "xx-XX", gender: "male", multilingual: true },
  ];
  return { FAKE_ENGINE: "fake", UNCONFIGURED_ENGINE: "unconfigured", FAKE_DEFAULT, FAKE_VOICES };
});

vi.mock("anytts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("anytts")>();
  return {
    ...actual,
    listEngines: () => [
      ...actual.listEngines(),
      { id: FAKE_ENGINE, label: "Fake engine", runtimes: ["browser"] },
      { id: UNCONFIGURED_ENGINE, label: "Unconfigured engine", runtimes: ["browser"] },
    ],
    listVoices: (engine: string) =>
      engine === FAKE_ENGINE ? FAKE_VOICES.map((v) => ({ ...v })) : actual.listVoices(engine),
  };
});

vi.mock("../engines", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engines")>();
  return { ...actual, speechEngines: () => [...actual.speechEngines(), FAKE_ENGINE] };
});

vi.mock("../synth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../synth")>();
  return {
    ...actual,
    resolveSpeechVoice: (q: { engine: string; voice?: string }) =>
      q.engine === FAKE_ENGINE
        ? FAKE_VOICES.some((v) => v.id === q.voice)
          ? { voice: q.voice!, fellBack: false }
          : { voice: FAKE_DEFAULT, fellBack: q.voice !== undefined }
        : actual.resolveSpeechVoice(q),
  };
});

const VOICE_LABEL = "Default voice";
const VOICE_KEY = storageKey(preferences.speechVoice);

const HELP_TEXT =
  "Multilingual voices read both Polish and English; a single-language voice reads every answer in its own language. Saved in the workspace; a project can override it in its Overview → Project settings.";

function prefsDocument(): Record<string, unknown> {
  return (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;
}

function engineSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Engine" }) as HTMLSelectElement;
}

/** The settings page lists agent config files over `fetch`; it needs none here. */
function stubEmptyAgentSettingsApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
}

function routeSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Speech route" }) as HTMLSelectElement;
}

const ROUTE_HELP_TEXT =
  "Kept on this device. Microsoft's speech service answers only Edge, so other browsers always go through the panel server.";

function voiceSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: VOICE_LABEL }) as HTMLSelectElement;
}

describe("VoiceSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an engine select and grouped voice options for a Polish browser", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("pl-PL");
    setStoredVoice("de-DE-SeraphinaMultilingualNeural");

    render(<VoiceSelect />);

    // The engine list is the seam's configured engines, labelled by anytts;
    // one anytts lists but the seam does not configure is never offered.
    const engine = engineSelect();
    const engines = within(engine).getAllByRole("option") as HTMLOptionElement[];
    const offered = listEngines().filter((e) => e.id !== UNCONFIGURED_ENGINE);
    expect(engines.map((option) => option.value)).toEqual(offered.map((e) => e.id));
    expect(engines.map((option) => option.textContent)).toEqual(offered.map((e) => e.label));
    expect(engines.map((option) => option.value)).not.toContain(UNCONFIGURED_ENGINE);
    expect(engine).toHaveValue("edge");

    // The voices are the engine's catalog, in the groups `groupVoices` builds
    // for the browser language — same labels, same ids, same order, no extras.
    const select = voiceSelect();
    const expected = groupVoices(listVoices("edge"), "pl-PL");
    expect(expected.map((group) => group.label)).toEqual(["Multilingual", "Polish", "English"]);
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map((group) => group.label)).toEqual(expected.map((group) => group.label));
    groups.forEach((group, index) => {
      const options = Array.from(group.querySelectorAll("option"));
      expect(options.map((option) => option.value)).toEqual(expected[index]!.voices.map((v) => v.id));
      expect(options.map((option) => option.textContent)).toEqual(
        expected[index]!.voices.map((v) => v.label),
      );
    });
    expect(within(select).getAllByRole("option")).toHaveLength(listVoices("edge").length);

    // Selected state read off the accessible option, not a class name.
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];
    expect(options.filter((option) => option.selected).map((option) => option.value)).toEqual([
      "de-DE-SeraphinaMultilingualNeural",
    ]);
    expect(select).toHaveValue("de-DE-SeraphinaMultilingualNeural");

    expect(screen.getByText(HELP_TEXT)).toBeInTheDocument();
  });

  it("a stale stored voice falls back to the engine default and is written back", () => {
    prefsDocument()[VOICE_KEY] = "xx-XX-NobodyNeural";

    render(<VoiceSelect />);

    expect(voiceSelect()).toHaveValue(DEFAULT_SPEECH_VOICE);
    expect(prefsDocument()[VOICE_KEY]).toBe(DEFAULT_SPEECH_VOICE);
  });

  it("changing the engine stores speech.engine and reloads the voice list", async () => {
    const user = userEvent.setup();
    render(<VoiceSelect />);
    expect(within(voiceSelect()).getAllByRole("option")).toHaveLength(listVoices("edge").length);

    await user.selectOptions(engineSelect(), FAKE_ENGINE);

    expect(prefsDocument()[storageKey(preferences.speechEngine)]).toBe(FAKE_ENGINE);
    expect(engineSelect()).toHaveValue(FAKE_ENGINE);
    // The list is now the other engine's catalog, and the edge voice that was
    // picked is not in it, so the engine default is shown and written back.
    const options = within(voiceSelect()).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((option) => option.value)).toEqual(FAKE_VOICES.map((v) => v.id));
    expect(voiceSelect()).toHaveValue(FAKE_DEFAULT);
    expect(prefsDocument()[VOICE_KEY]).toBe(FAKE_DEFAULT);

    await user.selectOptions(engineSelect(), "edge");
    expect(within(voiceSelect()).getAllByRole("option")).toHaveLength(listVoices("edge").length);
  });

  it("persists the selection as a portable preference", async () => {
    const user = userEvent.setup();

    render(<VoiceSelect />);

    const select = voiceSelect();
    expect(select).toHaveValue(DEFAULT_SPEECH_VOICE);

    await user.selectOptions(select, "fr-FR-VivienneMultilingualNeural");

    expect(
      (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__![
        storageKey(preferences.speechVoice)
      ],
    ).toBe("fr-FR-VivienneMultilingualNeural");
    // The voice is a choice about the panel, not about this machine, so it
    // travels in the workspace file and touches no browser storage.
    expect(localStorage.length).toBe(0);
    // What the player reads on every play() — the pick is live for synthesis.
    expect(getStoredVoice()).toBe("fr-FR-VivienneMultilingualNeural");
    expect(select).toHaveValue("fr-FR-VivienneMultilingualNeural");
  });

  it("shows the stored voice and engine when the document never arrived", async () => {
    const user = userEvent.setup();
    // The auth interlock stands in for the old blocked-site-data case.
    delete (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__;

    render(<VoiceSelect />);

    await expect(
      user.selectOptions(voiceSelect(), "it-IT-GiuseppeMultilingualNeural"),
    ).resolves.not.toThrow();
    await user.selectOptions(engineSelect(), FAKE_ENGINE);

    // Nothing was persisted, and synthesis reads what is stored — so the
    // controls show the stored picks rather than an attempt that never applied.
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    expect(voiceSelect()).toHaveValue(DEFAULT_SPEECH_VOICE);
    expect(engineSelect()).toHaveValue("edge");
  });

  it("renders the speech route select, defaulting to auto", () => {
    render(<VoiceSelect />);

    const route = routeSelect();
    const options = within(route).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((option) => option.value)).toEqual(["auto", "server"]);
    expect(options.map((option) => option.textContent)).toEqual([
      "Auto — straight from the browser in Edge, through the panel server elsewhere",
      "Panel server — always synthesize through /api/tts",
    ]);
    expect(route).toHaveValue("auto");
    expect(screen.getByText(ROUTE_HELP_TEXT)).toBeInTheDocument();
    // Rendering alone stores nothing.
    expect(localStorage.getItem(storageKey(preferences.speechRoute))).toBeNull();
  });

  it("changing the speech route stores speech.route on this device only", async () => {
    const user = userEvent.setup();
    render(<VoiceSelect />);

    await user.selectOptions(routeSelect(), "server");

    expect(routeSelect()).toHaveValue("server");
    expect(readPreference(preferences.speechRoute)).toBe("server");
    // Non-portable: kept in browser storage, never in the workspace document.
    expect(localStorage.getItem(storageKey(preferences.speechRoute))).toBe("server");
    expect(prefsDocument()[storageKey(preferences.speechRoute)]).toBeUndefined();
  });

  it("keeps the stored route when browser storage refuses the write", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    render(<VoiceSelect />);

    await user.selectOptions(routeSelect(), "server");

    expect(setItem).toHaveBeenCalled();
    // synth.ts reads the stored route per request, so the select must too.
    expect(readPreference(preferences.speechRoute)).toBe("auto");
    expect(routeSelect()).toHaveValue("auto");
  });

  it("the settings picker is labelled Default voice", () => {
    render(<VoiceSelect />);

    // A project can override the voice, so the Settings pick is the fallback.
    expect(screen.getByLabelText("Default voice")).toBe(voiceSelect());
    expect(screen.queryByText("Speech voice")).not.toBeInTheDocument();
  });

  it("the help text points to project overrides, not this browser", () => {
    render(<VoiceSelect />);

    expect(
      screen.getByText(
        HELP_TEXT,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/this browser/)).not.toBeInTheDocument();
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
        <SpeechHostProvider>
          <LeftSidebar />
        </SpeechHostProvider>
      </MemoryRouter>,
    );
    // The test id is part of the contract and must survive the relabelling.
    const entry = screen.getByTestId("sidebar-agent-settings");
    expect(entry).toHaveTextContent("Settings");
    expect(entry).not.toHaveTextContent("Agent Settings");
    sidebar.unmount();

    // The breadcrumb carries the relabelled entry too.
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
  });
});
