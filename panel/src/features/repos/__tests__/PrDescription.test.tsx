import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeSpeech, synthMock } from "../../speech/__tests__/speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../../speech/useSpeechHost";

/**
 * The real `SpeechHostProvider` with only its host swapped (as in
 * ViewerActions.speech.test): Play must reach the panel's one host.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../../speech/synth", () => synthMock());
vi.mock("../../speech/useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../../speech/useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../../speech/useSpeechKeys", () => ({ useSpeechKeys: () => {} }));
vi.mock("../../realtime/useWebSocket", () => ({ useWebSocket: () => ({ lastMessage: null }) }));
vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import PrDescription, { prSpeechKey } from "../PrDescription";
import { pr } from "./prFixtures";

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

function Host({ children }: { children: ReactNode }) {
  return (
    <SpeechHostProvider
      sessionOf={() => undefined}
      isSessionOpen={() => false}
      focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
      drawerVisible={false}
      onArrival={() => {}}
      answerWaiting={answerWaiting}
      voiceFor={() => "a-voice"}
    >
      {children}
    </SpeechHostProvider>
  );
}

const PR = pr({ number: 7 });
const aside = () => screen.getByRole("complementary", { name: "Pull request description" });
const play = () => within(aside()).getByTestId("pr-description-play");

beforeEach(() => {
  stub.host = makeSpeech();
});
afterEach(() => {
  stub.host = null;
});

describe("PrDescription", () => {
  it("renders the PR body as markdown", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body={"## Why\n\nFixes the thing."} />
      </Host>,
    );
    expect(within(aside()).getByRole("heading", { name: "Description" })).toBeInTheDocument();
    expect(within(aside()).getByTestId("md")).toHaveTextContent("Fixes the thing.");
  });

  it("Play reads the description in the project's voice", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body={"## Why\n\nFixes the thing."} />
      </Host>,
    );
    fireEvent.click(play());
    const key = prSpeechKey("pavilio", PR);
    // First segment is the project: the page speaks in that project's voice.
    expect(key.startsWith("doc:pavilio/")).toBe(true);
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({ key, text: "## Why\n\nFixes the thing." });
    expect(play()).toHaveAccessibleName("Stop");
  });

  it("says so when the PR has no description, and offers no Play", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body="" />
      </Host>,
    );
    expect(aside()).toHaveTextContent("No description provided.");
    expect(play()).toBeDisabled();
  });

  it("shows a loading line until the body arrives", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body={null} />
      </Host>,
    );
    expect(aside()).toHaveTextContent("Loading description…");
  });
});
