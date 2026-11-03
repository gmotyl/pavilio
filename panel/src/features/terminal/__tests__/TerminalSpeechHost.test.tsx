import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { SpeechHostProvider } from "../../speech/SpeechHostProvider";

/**
 * `TerminalSpeechHost` is the one component that sees both features: it reads
 * the terminal's stores and hands the speech provider its ports. The provider
 * is stubbed so the suite reads exactly what it was given.
 */
type ProviderProps = ComponentProps<typeof SpeechHostProvider>;

const state = vi.hoisted(() => ({
  props: null as ProviderProps | null,
  sessions: [] as Array<{ id: string; project: string; name: string }>,
  drawerVisible: false,
}));

vi.mock("../../speech/SpeechHostProvider", () => ({
  SpeechHostProvider: (props: ProviderProps) => {
    state.props = props;
    return props.children;
  },
}));
vi.mock("../sessionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sessionStore")>()),
  getSessions: () => state.sessions,
}));
vi.mock("../useTerminalDrawer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useTerminalDrawer")>()),
  useTerminalDrawerVisible: () => state.drawerVisible,
}));

import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { __resetOpenaiVoicesForTests } from "../../speech/useOpenaiVoices";
import { voiceForProject } from "../../speech/voices";
import { LIVE_VOICES, OPENAI_VOICES_URL, PL_FEMALE, voicesBody } from "../../speech/__tests__/openaiVoiceFixtures";
import { TerminalSpeechHost } from "../TerminalSpeechHost";
import { dismissAttentionOnArrival } from "../attentionArrival";
import { getAnswerWaiting, holdAnswer, isAnswerHeld, noteTransport, releaseAnswer } from "../answerWaiting";
import { voiceForSession } from "../sessionVoice";
import { readTerminalFocus, TERMINAL_FOCUS_EVENT } from "../useTerminalSessions";
import {
  publishStandaloneTerminalFocus,
  readStandaloneTerminalFocus,
} from "../standaloneTerminalFocus";

afterEach(() => {
  state.props = null;
  state.sessions = [];
  state.drawerVisible = false;
  publishStandaloneTerminalFocus(null);
  __resetOpenaiVoicesForTests();
  vi.unstubAllGlobals();
});

describe("TerminalSpeechHost", () => {
  it("TerminalSpeechHost wires session lookup, focus and arrival dismissal into the provider", () => {
    state.drawerVisible = true;
    const { getByText } = render(
      <TerminalSpeechHost>
        <span>child</span>
      </TerminalSpeechHost>,
    );
    getByText("child");
    const props = state.props!;

    // Sessions: looked up in the store at the moment of asking.
    expect(props.sessionOf("s1")).toBeUndefined();
    state.sessions = [{ id: "s1", project: "alpha", name: "one" }];
    expect(props.sessionOf("s1")).toEqual({ id: "s1", project: "alpha", name: "one" });
    // An empty list is "not loaded yet" and rules nothing out.
    state.sessions = [];
    expect(props.isSessionOpen("gone")).toBe(true);
    state.sessions = [{ id: "s1", project: "alpha", name: "one" }];
    expect(props.isSessionOpen("gone")).toBe(false);
    expect(props.isSessionOpen("s1")).toBe(true);

    // Focus: the project's focus preference and the standalone page's.
    expect(props.focusedCell.read).toBe(readTerminalFocus);
    expect(props.focusedCell.readStandalone).toBe(readStandaloneTerminalFocus);
    const onChange = vi.fn();
    const unsubscribe = props.focusedCell.subscribe(onChange);
    window.dispatchEvent(new Event(TERMINAL_FOCUS_EVENT));
    expect(onChange).toHaveBeenCalledTimes(1);
    publishStandaloneTerminalFocus("s1");
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event(TERMINAL_FOCUS_EVENT));
    publishStandaloneTerminalFocus("s2");
    expect(onChange).toHaveBeenCalledTimes(2);

    // Drawer visibility, arrival dismissal, answer waiting and voices.
    expect(props.drawerVisible).toBe(true);
    expect(props.onArrival).toBe(dismissAttentionOnArrival);
    expect(props.voiceFor).toBe(voiceForSession);
    expect(props.answerWaiting).toEqual({
      get: getAnswerWaiting,
      hold: holdAnswer,
      release: releaseAnswer,
      noteTransport,
      isHeld: isAnswerHeld,
    });
  });

  it("primes the OmniVoice list, so a saved openai voice resolves after a reload", async () => {
    writePreference(preferences.speechEngine, "openai");
    writePreference(preferences.speechVoice, { openai: PL_FEMALE.id });
    const fetchMock = stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody(LIVE_VOICES)) });

    render(<TerminalSpeechHost>child</TerminalSpeechHost>);

    await waitFor(() => expect(voiceForProject(undefined)).toBe(PL_FEMALE.id));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(OPENAI_VOICES_URL))).toHaveLength(1);
  });

  it("primes the list under a cascade that runs openai, and asks for nothing otherwise", async () => {
    const fetchMock = stubFetch({ [OPENAI_VOICES_URL]: () => jsonResponse(voicesBody(LIVE_VOICES)) });
    const listed = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(OPENAI_VOICES_URL));

    writePreference(preferences.speechEngine, "edge");
    const edge = render(<TerminalSpeechHost>child</TerminalSpeechHost>);
    expect(listed()).toHaveLength(0);
    edge.unmount();

    writePreference(preferences.speechEngine, "cascade");
    writePreference(preferences.speechCascadeOrder, [
      { id: "edge", on: true },
      { id: "openai", on: true },
    ]);
    render(<TerminalSpeechHost>child</TerminalSpeechHost>);
    await waitFor(() => expect(listed()).toHaveLength(1));
  });
});
