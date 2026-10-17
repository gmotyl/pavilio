import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { DEFAULT_SPEECH_VOICE, voiceForSession } from "../voices";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";
import { usePreference } from "../../../preferences/usePreference";

/**
 * `voiceForSession` runs during render in the answer pane and the control bar,
 * each subscribed to `speech.voice`. A stale stored voice delivered by a
 * preference change must be RESOLVED there, never written back: a write
 * notifies synchronously, so the first reader would set state on every other
 * subscriber mid-render ("Cannot update a component while rendering a
 * different component") and fire a PATCH from render.
 */
const VOICE_KEY = storageKey(preferences.speechVoice);
const STALE = "xx-XX-NobodyNeural";

function prefsDocument(): Record<string, unknown> {
  return (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;
}

/** Reads the voice the way AnswerPane and SpeechControlBar do. */
function VoiceReader({ id }: { id: string }) {
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  return <span data-testid={id}>{voiceForSession("sess-unplaced")}</span>;
}

describe("voice readers on a render path", () => {
  it("a stale stored voice arriving by a preference change is resolved read-only", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <VoiceReader id="a" />
        <VoiceReader id="b" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent(DEFAULT_SPEECH_VOICE);

    act(() => writePreference(preferences.speechVoice, STALE));

    // Both readers show the engine default the stale id resolves to...
    expect(screen.getByTestId("a")).toHaveTextContent(DEFAULT_SPEECH_VOICE);
    expect(screen.getByTestId("b")).toHaveTextContent(DEFAULT_SPEECH_VOICE);
    // ...without React's cross-component setState warning...
    const crossRender = errors.mock.calls.filter((args) =>
      args.some((arg) => String(arg).includes("Cannot update a component")),
    );
    expect(crossRender).toEqual([]);
    // ...and without writing from render: the write-back is the Settings
    // picker's, on mount, so the stored value is untouched here.
    expect(prefsDocument()[VOICE_KEY]).toBe(STALE);
  });
});
