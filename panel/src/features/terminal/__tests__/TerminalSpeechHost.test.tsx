import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
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
});
