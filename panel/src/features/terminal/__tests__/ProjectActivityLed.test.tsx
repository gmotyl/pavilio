import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  const { INERT_SPEECH_HOST } = await import("./speech.harness");
  const host = {
    ...INERT_SPEECH_HOST,
    // Read through the holder so a test can swap the state before it renders.
    stateFor: (sessionId: string) => stub.stateFor(sessionId),
  };
  return { useSpeechHost: () => host, default: () => host };
});

import { ProjectActivityLed } from "../ProjectActivityLed";
import { TerminalSpeechHost } from "../TerminalSpeechHost";
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
  <TerminalSpeechHost>{children}</TerminalSpeechHost>
);

function leds(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".terminal-led")).map((el) =>
    el.getAttribute("data-state"),
  );
}

describe("ProjectActivityLed", () => {
  /** The one fixed-width slot every project row reserves before its mark. */
  const slotOf = (container: HTMLElement) =>
    container.querySelector('[data-testid="project-activity-slot"]');

  it("no terminals renders an empty slot", () => {
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={[]} />
      </Wrap>,
    );
    // Empty, but present: the slot is what keeps the mark tiles aligned.
    const slot = slotOf(container);
    expect(slot).not.toBeNull();
    expect(slot).toHaveClass("project-activity-slot");
    expect(slot!.childElementCount).toBe(0);
  });

  it("a project with no open terminals keeps an empty slot even while speaking", () => {
    stub.stateFor = () => "speaking";

    // No ids at all is what "no open terminals" means to the aggregate; a
    // speaking host must not conjure a speaker for a project that has none.
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={[]} />
      </Wrap>,
    );

    expect(slotOf(container)!.childElementCount).toBe(0);
  });

  it("idle-only project shows one idle dot", () => {
    set("a", "idle");
    set("b", "idle");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["idle"]);
  });

  it("busy wins over idle in the aggregate dot", () => {
    set("a", "busy");
    set("b", "idle");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["busy"]);
    // Labelled like the idle and attention dots, so a screen reader names it.
    expect(container.querySelector('.terminal-led[data-state="busy"]')).toHaveAttribute(
      "aria-label",
      "Busy",
    );
  });

  it("attention wins over busy in the aggregate dot", () => {
    set("a", "busy");
    // A fresh attention state, so the pulse is live.
    _applyEventForTests({
      sessionId: "b",
      state: "attention",
      at: Date.now(),
      attentionSinceAt: Date.now(),
    });
    set("c", "idle");
    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b", "c"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual(["attention"]);
    // The attention pulse survives the collapse to one dot.
    expect(
      container.querySelector('.terminal-led[data-state="attention"]'),
    ).toHaveAttribute("data-pulse", "1");
  });

  it("speaker replaces the aggregate dot while a session speaks", () => {
    set("a", "busy");
    set("b", "attention");
    stub.stateFor = (id) => (id === "a" ? "speaking" : "empty");

    const { container } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );

    // Whatever the other states, the slot holds only the speaker.
    expect(leds(container)).toEqual([]);
    const slot = slotOf(container)!;
    expect(slot.childElementCount).toBe(1);
    expect(
      within(slot as HTMLElement).getByTestId("session-speaker-a"),
    ).toHaveAttribute("aria-label", "Speaking");
  });

  it("dot returns when the speaker stops", () => {
    set("a", "idle");
    set("b", "attention");
    stub.stateFor = (id) => (id === "a" ? "speaking" : "empty");

    const { container, rerender } = render(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );
    expect(leds(container)).toEqual([]);

    stub.stateFor = () => "empty";
    rerender(
      <Wrap>
        <ProjectActivityLed sessionIds={["a", "b"]} />
      </Wrap>,
    );

    expect(screen.queryByTestId("session-speaker-a")).toBeNull();
    expect(leds(container)).toEqual(["attention"]);
  });

  it("throws when no SpeechHostProvider is above it", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ProjectActivityLed sessionIds={["a"]} />)).toThrow(
      /usePanelSpeech/,
    );
    quiet.mockRestore();
  });
});
