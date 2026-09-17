import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  const { INERT_SPEECH_HOST } = await import("./speech.harness");
  const host = {
    ...INERT_SPEECH_HOST,
    // Read through the holder so a test can swap the state before it renders.
    stateFor: (sessionId: string) => stub.stateFor(sessionId),
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

/**
 * The stylesheet as text, resolved relative to THIS FILE rather than to
 * `process.cwd()` — which is what it used to be, and only held while the runner
 * happened to be started from `panel/`.
 *
 * Two spellings that look tidier do not work here: a Vite `?raw` import returns
 * "" because vitest stubs CSS modules out unless `test.css` is on, and it does
 * not spare `?raw`; and handing `readFileSync` a `new URL(...)` throws "must be
 * of scheme file", because in jsdom `URL` is jsdom's, not node's. So the URL is
 * converted to a path explicitly.
 */
const indexCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../index.css"),
  "utf8",
);

/** The declarations of one CSS rule in `index.css`, as `prop: value` pairs. */
function ruleOf(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(indexCss);
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

/**
 * Properties that decide how much room a rule takes in its row, beyond the box
 * itself. Compared as a whole SET rather than one or two named properties: an
 * earlier version checked only `width` and `height`, which let a
 * `margin: 4px; padding: 3px` on `.session-speaker` pass while moving the row's
 * text by 14px — exactly the thing the box is supposed to guarantee.
 */
const BOX_KEYS = [
  "display",
  "width",
  "height",
  "box-sizing",
  "flex",
  "flex-shrink",
  "flex-basis",
  "min-width",
  "min-height",
] as const;

/** Prefixes whose EVERY spelling — longhand, shorthand, logical — is geometry. */
const SPACING_PREFIXES = ["margin", "padding", "border"] as const;

/**
 * ...except the ones that add no thickness. `border-radius` is out on purpose:
 * the LED is a circle and the speaker is a glyph box, so they legitimately
 * differ there, and a radius moves nothing. Colors likewise.
 */
const NOT_GEOMETRY = /(?:^|-)(?:radius|color)$/;

const spacingKeysOf = (rule: Record<string, string>): string[] =>
  Object.keys(rule).filter((key) =>
    SPACING_PREFIXES.some((p) => key === p || key.startsWith(`${p}-`)),
  );

/**
 * The keys to compare: the fixed set above, plus every spacing key either rule
 * actually declares — so a margin added to ONE side still enters the
 * comparison, where "absent" is the value it is measured against.
 */
function boxKeysOf(...rules: Record<string, string>[]): string[] {
  const declared = rules
    .flatMap(spacingKeysOf)
    .filter((key) => !NOT_GEOMETRY.test(key));
  return [...new Set<string>([...BOX_KEYS, ...declared])].sort();
}

/** One rule's box, with "absent" standing in for an undeclared property. */
const boxOf = (rule: Record<string, string>, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, rule[key] ?? "absent"]));

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
    for (const [speakerSelector, ledSelector] of [
      [".session-speaker", ".terminal-led"],
      [".session-speaker-lg", ".terminal-led-lg"],
    ] as const) {
      const ledRule = ruleOf(ledSelector);
      const speakerRule = ruleOf(speakerSelector);
      const keys = boxKeysOf(ledRule, speakerRule);
      expect(boxOf(speakerRule, keys), speakerSelector).toEqual(
        boxOf(ledRule, keys),
      );
    }
  });

  it("the speaker declares no margin, padding or border of its own", () => {
    // Stated positively, and separately from the comparison above, so that the
    // day someone adds spacing here the failure names the reason instead of
    // reading as an opaque diff: the speaker overflows its box on purpose (the
    // glyph is bigger than 6px), and any margin, padding or border would turn
    // that overflow into real layout and shove the row's text sideways the
    // moment the indicator switches.
    for (const selector of [".session-speaker", ".session-speaker-lg"]) {
      expect(spacingKeysOf(ruleOf(selector)), selector).toEqual([]);
    }
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
