/**
 * The per-project voice picker on a project's Overview: "Default" is a real
 * option labelled with the voice it resolves to, and an override shows a tag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectVoiceSelect } from "../ProjectVoiceSelect";
import { listVoices } from "anytts";

import { groupVoices } from "../voiceGroups";
import {
  DEFAULT_SPEECH_VOICE,
  getProjectVoice,
  setStoredEngine,
  setProjectVoice,
  setEngineVoice,
} from "../voices";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { stubFetch } from "../../../test-utils";
import { __resetOpenaiVoicesForTests } from "../useOpenaiVoices";
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
