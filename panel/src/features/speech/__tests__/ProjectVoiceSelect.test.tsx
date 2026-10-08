/**
 * The per-project voice picker on a project's Overview: "Default" is a real
 * option labelled with the voice it resolves to, and an override shows a tag.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectVoiceSelect } from "../ProjectVoiceSelect";
import {
  DEFAULT_SPEECH_VOICE,
  SPEECH_VOICES,
  getProjectVoice,
  setProjectVoice,
  setStoredVoice,
} from "../voices";

const ANDREW = "en-US-AndrewMultilingualNeural";
const EMMA = "en-US-EmmaMultilingualNeural";

function labelOf(id: string): string {
  const voice = SPEECH_VOICES.find((v) => v.id === id);
  if (!voice) throw new Error(`unknown voice ${id}`);
  return voice.label;
}

function select(): HTMLSelectElement {
  return screen.getByTestId("project-voice-select") as HTMLSelectElement;
}

describe("ProjectVoiceSelect", () => {
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
      setStoredVoice(ANDREW);
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

  it("only multilingual voices are offered", () => {
    render(<ProjectVoiceSelect project="p" />);

    const options = within(select()).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["", ...SPEECH_VOICES.map((v) => v.id)]);
    expect(options.slice(1).map((o) => o.textContent)).toEqual(
      SPEECH_VOICES.map((v) => v.label),
    );
  });
});
