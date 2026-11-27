/**
 * The per-project voice picker on a project's Overview: "Default" is a real
 * option labelled with the voice it resolves to, and an override shows a tag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectVoiceSelect } from "../ProjectVoiceSelect";
import { RateButton } from "../RateButton";
import { listEngines, listVoices } from "anytts";

import { groupVoices } from "../voiceGroups";
import {
  DEFAULT_SPEECH_VOICE,
  getProjectVoice,
  setStoredEngine,
  setProjectVoice,
  setEngineVoice,
  engineFor,
  setProjectEngine,
} from "../voices";
import { readPreference } from "../../../preferences/store";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { stubFetch } from "../../../test-utils";
import { __resetOpenaiVoicesForTests } from "../useOpenaiVoices";
import { __resetPocketVoicesForTests } from "../usePocketVoices";
import { speechEngines } from "../engines";
import { jsonResponse } from "../../../test-utils";
import { EN_MALE, LIVE_VOICES, MY_VOICE, OPENAI_VOICES_URL, voicesBody } from "./openaiVoiceFixtures";

const ANDREW = "en-US-AndrewMultilingualNeural";
const EMMA = "en-US-EmmaMultilingualNeural";

function labelOf(id: string): string {
  const voice = listVoices("edge").find((v) => v.id === id);
  if (!voice) throw new Error(`unknown voice ${id}`);
  return voice.label;
}

function select(): HTMLSelectElement {
  return screen.getByTestId("project-voice-select") as HTMLSelectElement;
}

describe("ProjectVoiceSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __resetOpenaiVoicesForTests();
    __resetPocketVoicesForTests();
  });

  describe("engine select", () => {
    const engineSelect = () => screen.getByRole("combobox", { name: "Engine" }) as HTMLSelectElement;
    const labelOfEngine = (id: string) => listEngines().find((e) => e.id === id)!.label;
    const POCKET_VOICES_URL = "/api/speech/pocket/voices";

    it("the engine select comes first with Default, Cascade and every engine", () => {
      render(<ProjectVoiceSelect project="p" />);

      expect(screen.getAllByRole("combobox")[0]).toBe(engineSelect());
      const options = within(engineSelect()).getAllByRole("option") as HTMLOptionElement[];
      expect(options.map((o) => o.textContent)).toEqual([
        `Default (${labelOfEngine("edge")})`,
        "Cascade",
        ...listEngines()
          .filter((e) => e.id !== "cascade" && speechEngines().includes(e.id))
          .map((e) => e.label),
      ]);
      expect(options.map((o) => o.value).slice(0, 2)).toEqual(["", "cascade"]);
      expect(engineSelect().value).toBe("");
    });

    it("the Default option follows the global engine", () => {
      render(<ProjectVoiceSelect project="p" />);

      act(() => {
        setStoredEngine("kokoro");
      });

      expect(engineSelect().selectedOptions[0]!.textContent).toBe(`Default (${labelOfEngine("kokoro")})`);
    });

    it("picking an engine stores it and switches the voice list", async () => {
      stubFetch({
        [POCKET_VOICES_URL]: () =>
          jsonResponse({ voices: [{ id: "piotr", label: "Piotr", version: 1 }], cloning: true }),
      });
      const user = userEvent.setup();
      render(<ProjectVoiceSelect project="p" />);

      await user.selectOptions(engineSelect(), "pocket-pl");

      expect(engineFor("p")).toBe("pocket-pl");
      expect(engineFor("q")).toBe("edge");
      await waitFor(() =>
        expect(within(select()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
          "",
          "shefowl",
          "piotr",
        ]),
      );
    });

    it("picking Cascade shows the member voice rows", async () => {
      stubFetch({ "/api/speech/engines": [] }, null);
      const user = userEvent.setup();
      render(<ProjectVoiceSelect project="p" />);

      await user.selectOptions(engineSelect(), "cascade");

      expect(engineFor("p")).toBe("cascade");
      expect(screen.getByTestId("project-cascade-voices")).toBeTruthy();
      expect(screen.queryByTestId("project-voice-select")).toBeNull();
    });

    it("Default removes the project engine", async () => {
      setProjectEngine("p", "pocket-pl");
      stubFetch({ [POCKET_VOICES_URL]: () => jsonResponse({ voices: [], cloning: true }) });
      const user = userEvent.setup();
      render(<ProjectVoiceSelect project="p" />);
      expect(engineSelect().value).toBe("pocket-pl");

      await user.selectOptions(engineSelect(), "");

      expect(readPreference(preferences.speechEngineByProject)).toEqual({});
      expect(engineFor("p")).toBe("edge");
      expect(engineSelect().value).toBe("");
    });
  });

  it("the picker slider and every row button share the project speed", () => {
    render(
      <>
        <ProjectVoiceSelect project="p" />
        <RateButton project="p" />
      </>,
    );
    const slider = screen.getByTestId("project-rate-slider") as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(["0.5", "2", "0.1"]);

    fireEvent.change(slider, { target: { value: "1.3" } });

    expect(readPreference(preferences.speechRateByProject)).toEqual({ p: 1.3 });
    expect(screen.getByTestId("project-rate-button")).toHaveTextContent("1.3×");
    expect(screen.getByTestId("speech-bar-rate-p")).toHaveTextContent("1.3×");
  });

  it("with no override the select shows the default voice by name", () => {
    render(<ProjectVoiceSelect project="p" />);

    expect(select().value).toBe("");
    const selected = select().selectedOptions[0];
    expect(selected.textContent).toBe(`Default — ${labelOf(DEFAULT_SPEECH_VOICE)}`);
    expect(screen.queryByText("overrides default")).toBeNull();
  });

  it("the Default label follows a changed default voice", () => {
    render(<ProjectVoiceSelect project="p" />);

    act(() => {
      setEngineVoice("edge", ANDREW);
    });

    expect(select().selectedOptions[0].textContent).toBe(`Default — ${labelOf(ANDREW)}`);
  });

  it("picking a voice stores the override and shows the tag", async () => {
    const user = userEvent.setup();
    render(<ProjectVoiceSelect project="p" />);

    await user.selectOptions(select(), EMMA);

    expect(getProjectVoice("p")).toBe(EMMA);
    expect(getProjectVoice("q")).toBeNull();
    expect(select().value).toBe(EMMA);
    expect(screen.getByText("overrides default")).toBeTruthy();
  });

  it("picking Default clears the override", async () => {
    setProjectVoice("p", EMMA);
    const user = userEvent.setup();
    render(<ProjectVoiceSelect project="p" />);
    expect(select().value).toBe(EMMA);
    expect(screen.getByText("overrides default")).toBeTruthy();

    await user.selectOptions(select(), "");

    expect(getProjectVoice("p")).toBeNull();
    expect(select().value).toBe("");
    expect(screen.queryByText("overrides default")).toBeNull();
  });

  it("project picker offers Default plus the same groups", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("pl-PL");
    render(<ProjectVoiceSelect project="p" />);

    // "Default" stays first and outside every group.
    const first = within(select()).getAllByRole("option")[0] as HTMLOptionElement;
    expect(first.value).toBe("");
    expect(first.parentElement).toBe(select());

    // Then the global engine's catalog, grouped exactly as the Settings picker
    // groups it for this browser language.
    const expected = groupVoices(listVoices("edge"), "pl-PL");
    const groups = Array.from(select().querySelectorAll("optgroup"));
    expect(groups.map((group) => group.label)).toEqual(expected.map((group) => group.label));
    groups.forEach((group, index) => {
      const options = Array.from(group.querySelectorAll("option"));
      expect(options.map((option) => option.value)).toEqual(expected[index]!.voices.map((v) => v.id));
      expect(options.map((option) => option.textContent)).toEqual(
        expected[index]!.voices.map((v) => v.label),
      );
    });
    expect(within(select()).getAllByRole("option")).toHaveLength(listVoices("edge").length + 1);
  });

  it("a project voice outside the catalog inherits the default", () => {
    (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__![
      storageKey(preferences.speechVoiceByProject)
    ] = { p: "xx-XX-NobodyNeural" };
    render(<ProjectVoiceSelect project="p" />);

    expect(select().value).toBe("");
    expect(select().selectedOptions[0]!.textContent).toBe(`Default — ${labelOf(DEFAULT_SPEECH_VOICE)}`);
    expect(screen.queryByText("overrides default")).toBeNull();
  });

  it("the Default label resolves a stale default voice to the engine default", () => {
    (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__![
      storageKey(preferences.speechVoice)
    ] = "xx-XX-NobodyNeural";
    render(<ProjectVoiceSelect project="p" />);

    expect(select().selectedOptions[0]!.textContent).toBe(`Default — ${labelOf(DEFAULT_SPEECH_VOICE)}`);
  });

  it("project voice select lists openai live catalog voices", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("pl-PL");
    stubFetch({ [OPENAI_VOICES_URL]: voicesBody() });
    expect(setStoredEngine("openai")).toBe("openai");
    const user = userEvent.setup();
    render(<ProjectVoiceSelect project="p" />);

    await waitFor(() => expect(within(select()).getAllByRole("option")).toHaveLength(LIVE_VOICES.length + 1));
    const options = within(select()).getAllByRole("option") as HTMLOptionElement[];
    expect(options[0]!.value).toBe("");
    // "Default" names the live voice the engine falls back to: the map's my-voice.
    expect(options[0]!.textContent).toBe(`Default — ${MY_VOICE.label}`);
    const expected = groupVoices([...LIVE_VOICES], "pl-PL");
    const groups = Array.from(select().querySelectorAll("optgroup"));
    expect(groups.map((group) => group.label)).toEqual(["Multilingual", "Polish", "English"]);
    expect(groups.map((group) => group.label)).toEqual(expected.map((group) => group.label));
    groups.forEach((group, index) => {
      expect(Array.from(group.querySelectorAll("option")).map((option) => option.value)).toEqual(
        expected[index]!.voices.map((v) => v.id),
      );
    });

    await user.selectOptions(select(), EN_MALE.id);
    expect(getProjectVoice("p")).toBe(EN_MALE.id);
    expect(screen.getByText("overrides default")).toBeTruthy();
  });
});
