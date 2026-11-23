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
  default: ({ content, untrusted }: { content: string; untrusted?: { linkBase: string } }) => (
    <div data-testid="md" data-link-base={untrusted?.linkBase}>
      {content}
    </div>
  ),
}));

import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import PrDescription, { prDescriptionSource, prSpeechKey } from "../PrDescription";
import { pageHasSpeech, pageSpeechText } from "../../speech/pageText";
import { docSpeechKeyFor } from "../../projects/docSpeech";
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

  it("renders the body as untrusted markdown resolved against the PR page", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body="Hi" />
      </Host>,
    );
    expect(within(aside()).getByTestId("md")).toHaveAttribute("data-link-base", PR.url);
  });

  it("toolbar label is its own class, so markdown h4s keep prose styles", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body="Hi" />
      </Host>,
    );
    expect(within(aside()).getByRole("heading", { name: "Description" })).toHaveClass("rv-desc-title");
  });

  it("a comment-only body (an untouched PR template) is no description", () => {
    render(
      <Host>
        <PrDescription project="pavilio" pr={PR} body={"<!-- Describe your change -->\n<!-- Link the issue -->"} />
      </Host>,
    );
    expect(aside()).toHaveTextContent("No description provided.");
    expect(play()).toBeDisabled();
  });
});

describe("prDescriptionSource", () => {
  it("drops HTML comments, so speech never reads template prompts", () => {
    const src = prDescriptionSource("Fixes it.\n\n<!-- Describe\nyour change -->\n\nDone.");
    expect(src).not.toContain("Describe");
    expect(src).toContain("Fixes it.");
    expect(src).toContain("Done.");
  });

  it("keeps comments that are code examples", () => {
    const fenced = "```html\n<!-- keep me -->\n```";
    expect(prDescriptionSource(fenced)).toContain("<!-- keep me -->");
    expect(prDescriptionSource("Use `<!-- x -->` here")).toContain("`<!-- x -->`");
  });

  it("text between leading horizontal rules is prose, not note frontmatter", () => {
    const src = prDescriptionSource("---\nSummary of the change.\n---\n");
    // The same text reaches the toolbar, the host and play-from-here, so all
    // three keep the paragraph.
    expect(pageSpeechText(src)).toContain("Summary of the change.");
    expect(pageHasSpeech(src)).toBe(true);
  });
});

describe("prSpeechKey", () => {
  it("keeps the project for the voice but can never equal a workspace file's key", () => {
    const key = prSpeechKey("pavilio", { repo: "web", number: 7 });
    expect(key.startsWith("doc:pavilio/")).toBe(true);
    const projects = "/h/projects";
    for (const file of ["pavilio/prs/web/7.md", "pavilio/prs/web/7", "pavilio/pr/web/7"]) {
      expect(docSpeechKeyFor(`${projects}/${file}`, projects)).not.toBe(key);
    }
    // A projects-relative path never carries an empty segment.
    expect(key).toContain("//");
  });
});

