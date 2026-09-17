import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CellSpeechState } from "../../speech/types";

/**
 * The host itself is stubbed, NOT `usePanelSpeech`: the component is required to
 * throw when no provider is above it, and mocking the hook would delete exactly
 * that guarantee. So the real `SpeechHostProvider` is mounted and only the host
 * it publishes is swapped — the context, the throw and the provider are real.
 */
const stub = vi.hoisted(() => ({
  stateFor: (_sessionId: string) => "empty" as CellSpeechState,
}));

vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH } = await import("./speech.harness");
  const host = {
    ...INERT_SPEECH,
    // Read through the holder so a test can swap the state before it renders.
    stateFor: (sessionId: string) => stub.stateFor(sessionId),
    // `SpeechHost` is `GridSpeech` plus what the document-wide media-session
    // transport reads; the provider mounts that transport, so it needs these.
    speakingSessionId: null,
    pausedSessionId: null,
    onSeekBackward: () => {},
    preparingSessionIds: new Set<string>(),
  };
  return { useSpeechHost: () => host, default: () => host };
});

import { ProjectActivityLed } from "../ProjectActivityLed";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import {
  _applyEventForTests,
  _resetForTests,
} from "../useTerminalActivityChannel";

afterEach(() => {
  _resetForTests();
  stub.stateFor = () => "empty";
});

const set = (sessionId: string, state: "idle" | "busy" | "attention") =>
  _applyEventForTests({
    sessionId,
    state,
    at: 1,
    attentionSinceAt: state === "attention" ? 1 : undefined,
  });

const Wrap = ({ children }: { children: ReactNode }) => (
  <SpeechHostProvider>{children}</SpeechHostProvider>
);

function leds(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".terminal-led")).map((el) =>
    el.getAttribute("data-state"),
  );
}

describe("ProjectActivityLed", () => {
  it("renders nothing when the project has no open terminals", () => {
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={[]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual([]);
  });

  it("shows an idle dot when a terminal is open but not working", () => {
    set("a", "idle");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["idle"]);
  });

  it("shows busy AND attention together when both states are present", () => {
    set("a", "busy");
    set("b", "attention");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["busy", "attention"]);
  });

  it("does not show an idle dot alongside busy/attention", () => {
    set("a", "busy");
    set("b", "idle");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["busy"]);
  });

  it("a speaking session adds a speaker beside the busy and attention dots", () => {
    set("a", "busy");
    set("b", "attention");
    stub.stateFor = (id) => (id === "b" ? "speaking" : "empty");

    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );

    // Speaking is one more status in the group: neither dot may be dropped,
    // least of all the attention dot, which belongs to a different session.
    expect(leds(container)).toEqual(["busy", "attention"]);
    expect(screen.getByTestId("session-speaker-b")).toHaveAttribute(
      "aria-label",
      "Speaking",
    );
  });

  it("an all-idle project swaps its idle dot for the speaker", () => {
    set("a", "idle");
    set("b", "idle");
    stub.stateFor = (id) => (id === "a" ? "speaking" : "empty");

    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );

    // "Idle" says less than "this is the row you are hearing", so the speaker
    // takes the idle dot's place rather than sitting next to it.
    expect(leds(container)).toEqual([]);
    expect(screen.getByTestId("session-speaker-a")).toBeInTheDocument();
  });

  it("a project with no open terminals renders nothing even while speaking", () => {
    stub.stateFor = () => "speaking";

    // No ids at all is what "no open terminals" means to the aggregate; a
    // speaking host must not conjure a group for a project that has none.
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={[]} />
      </Wrap>,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders byte-identical markup to the pre-speech group when nothing speaks", () => {
    set("a", "busy");
    set("b", "attention");

    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );

    // Pinned against the markup at 9e5cce1, before the speaking flag existed:
    // gaining a status must not move the dots or rewrite their attributes.
    expect(container.innerHTML).toBe(
      '<span class="flex items-center gap-1">' +
        '<span class="terminal-led" data-state="busy" title="Busy"></span>' +
        '<span class="terminal-led" data-state="attention" data-pulse="0" title="Needs attention" aria-label="Needs attention"></span>' +
        "</span>",
    );
  });

  it("throws when no SpeechHostProvider is above it", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ProjectActivityLed sessionIds={["a"]} />)).toThrow(
      /usePanelSpeech/,
    );
    quiet.mockRestore();
  });
});
