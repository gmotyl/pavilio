import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

import { SessionIndicator } from "../SessionIndicator";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import {
  _applyEventForTests,
  _resetForTests,
} from "../useTerminalActivityChannel";

afterEach(() => {
  _resetForTests();
  stub.stateFor = () => "empty";
});

const setActivity = (
  sessionId: string,
  state: "idle" | "busy" | "attention",
) =>
  _applyEventForTests({
    sessionId,
    state,
    at: 1,
    attentionSinceAt: state === "attention" ? 1 : undefined,
  });

const Wrap = ({ children }: { children: ReactNode }) => (
  <SpeechHostProvider>{children}</SpeechHostProvider>
);

/** The declarations of one CSS rule in `index.css`, as `prop: value` pairs. */
function ruleOf(selector: string): Record<string, string> {
  // `import.meta.url` is Vite's http URL under vitest, so the stylesheet is
  // resolved from the package root instead.
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!match) throw new Error(`no rule for ${selector} in index.css`);
  return Object.fromEntries(
    match[1]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

describe("SessionIndicator", () => {
  it("speaking shows a static speaker and no LED", () => {
    stub.stateFor = () => "speaking";
    setActivity("a", "attention");

    const { container } = render(
      <Wrap>
        <SessionIndicator sessionId="a" />
      </Wrap>,
    );

    const speaker = screen.getByTestId("session-speaker-a");
    expect(speaker).toHaveAttribute("aria-label", "Speaking");
    // The pulse means "something is waiting for you"; playing audio is not.
    expect(speaker.getAttribute("data-pulse")).not.toBe("1");
    expect(speaker.querySelector('[data-pulse="1"]')).toBeNull();
    expect(container.querySelector(".terminal-led")).toBeNull();
  });

  it("every other state shows the activity LED", () => {
    const others: CellSpeechState[] = [
      "empty",
      "preparing",
      "ready",
      "stalled",
      "paused",
      "heard",
    ];
    setActivity("a", "busy");

    for (const state of others) {
      stub.stateFor = () => state;
      const { container, unmount } = render(
        <Wrap>
          <SessionIndicator sessionId="a" size="lg" title="vector · dev" />
        </Wrap>,
      );

      const led = container.querySelector(".terminal-led");
      expect(led, state).not.toBeNull();
      expect(led).toHaveAttribute("data-state", "busy");
      // The props are forwarded, not swallowed.
      expect(led).toHaveAttribute("title", "vector · dev");
      expect(led?.classList.contains("terminal-led-lg")).toBe(true);
      expect(screen.queryByTestId("session-speaker-a")).toBeNull();
      unmount();
    }
  });

  it("an aggregate with one speaking id shows the speaker", () => {
    stub.stateFor = (id) => (id === "b" ? "speaking" : "ready");
    setActivity("a", "busy");
    setActivity("b", "busy");
    setActivity("c", "busy");

    const { container } = render(
      <Wrap>
        <SessionIndicator sessionIds={["a", "b", "c"]} />
      </Wrap>,
    );

    expect(screen.getByTestId("session-speaker-b")).toHaveAttribute(
      "aria-label",
      "Speaking",
    );
    expect(container.querySelector(".terminal-led")).toBeNull();
  });

  it("the speaker occupies the LED's box", () => {
    stub.stateFor = () => "speaking";

    const sm = render(
      <Wrap>
        <SessionIndicator sessionId="a" />
      </Wrap>,
    );
    const small = sm.getByTestId("session-speaker-a");
    expect(small.classList.contains("session-speaker")).toBe(true);
    expect(small.classList.contains("session-speaker-lg")).toBe(false);
    sm.unmount();

    const lg = render(
      <Wrap>
        <SessionIndicator sessionId="a" size="lg" />
      </Wrap>,
    );
    const large = lg.getByTestId("session-speaker-a");
    expect(large.classList.contains("session-speaker-lg")).toBe(true);

    // jsdom lays nothing out, so the box is pinned where it is declared: the
    // speaker's rules must measure exactly what the LED's do, or the row's text
    // moves when the indicator switches.
    const led = ruleOf(".terminal-led");
    const speaker = ruleOf(".session-speaker");
    expect(speaker.width).toBe(led.width);
    expect(speaker.height).toBe(led.height);
    expect(ruleOf(".session-speaker-lg").width).toBe(
      ruleOf(".terminal-led-lg").width,
    );
    expect(ruleOf(".session-speaker-lg").height).toBe(
      ruleOf(".terminal-led-lg").height,
    );
  });

  it("hideWhenIdle hides an idle indicator, exactly as the LED does", () => {
    setActivity("a", "idle");

    const { container } = render(
      <Wrap>
        <SessionIndicator sessionId="a" hideWhenIdle />
      </Wrap>,
    );

    expect(container.querySelector(".terminal-led")).toBeNull();
    expect(screen.queryByTestId("session-speaker-a")).toBeNull();
  });

  it("throws when no SpeechHostProvider is above it", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SessionIndicator sessionId="a" />)).toThrow(
      /usePanelSpeech/,
    );
    quiet.mockRestore();
  });
});
