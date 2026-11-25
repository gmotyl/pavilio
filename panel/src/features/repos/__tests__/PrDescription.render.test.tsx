import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { makeSpeech, synthMock } from "../../speech/__tests__/speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../../speech/useSpeechHost";

/**
 * PrDescription with the REAL markdown renderer: what the body loses on its way
 * to the screen. (PrDescription.test stubs the renderer to see the props.)
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
vi.mock("../../markdown/MermaidDiagram", () => ({ default: () => null }));

import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import PrDescription, { prDescriptionSource } from "../PrDescription";
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
    <MemoryRouter>
      <SpeechHostProvider
        sessionOf={() => undefined}
        isSessionOpen={() => false}
        focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
        drawerVisible={false}
        onArrival={() => {}}
        answerWaiting={answerWaiting}
        voiceFor={() => "a-voice"}
        languageFor={() => "en"}
      >
        {children}
      </SpeechHostProvider>
    </MemoryRouter>
  );
}

const renderBody = (body: string) =>
  render(
    <Host>
      <PrDescription project="pavilio" pr={pr({ number: 7 })} body={body} />
    </Host>,
  );
const view = () => screen.getByRole("region", { name: "Pull request description" });

beforeEach(() => {
  stub.host = makeSpeech();
});
afterEach(() => {
  stub.host = null;
});

describe("PrDescription rendering (real renderer)", () => {
  it("an escaped \\<!-- is literal text: nothing after it disappears", () => {
    const body = "Write \\<!-- to start a comment.\n\nThis paragraph must stay.";
    renderBody(body);
    expect(view()).toHaveTextContent("Write <!-- to start a comment.");
    expect(view()).toHaveTextContent("This paragraph must stay.");
    expect(prDescriptionSource(body)).toBe(body);
  });

  it("a comment in an indented code block is code, and stays", () => {
    const body = "Example:\n\n    <!-- literal comment -->\n\nAfter.";
    renderBody(body);
    expect(view().querySelector("pre code")).toHaveTextContent("<!-- literal comment -->");
    expect(view()).toHaveTextContent("After.");
    expect(prDescriptionSource(body)).toContain("<!-- literal comment -->");
  });

  it("a real comment, block or inline, is hidden and not spoken", () => {
    const body = "<!-- Describe your change -->\n\nFixes it <!-- inline note --> today.";
    renderBody(body);
    expect(view()).not.toHaveTextContent("Describe your change");
    expect(view()).not.toHaveTextContent("inline note");
    expect(view()).toHaveTextContent("Fixes it today.");
    const source = prDescriptionSource(body);
    expect(source).not.toContain("Describe your change");
    expect(source).not.toContain("inline note");
  });
});
