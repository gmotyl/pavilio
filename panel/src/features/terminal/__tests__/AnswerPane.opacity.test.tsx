/**
 * The answer body's per-project bottom-edge opacity (`answerOpacityBottom`).
 *
 * Contract: at a value n below 100 the body paints
 * `linear-gradient(to bottom, #17171d 0%, color-mix(in srgb, #17171d n%, transparent) 100%)`
 * and the pane itself is transparent behind it; at 100, or while the composer's
 * input holds focus and no wave is shown, the body is the solid `#17171d`. The
 * meta row and the composer's rows — the Retry Enter row among them — always
 * keep the solid ground.
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { __resetAnswerRetryForTests, armRetryOffer, beginRetryTicket, RETRY_OFFER_MS } from "../answerRetry";
import { __resetAnswerWaitingForTests, beginWaiting, holdAnswer } from "../answerWaiting";
import { _applyEventForTests, _resetForTests as resetActivityForTests } from "../useTerminalActivityChannel";
import { installMatchMedia, StubResizeObserver } from "../../../test-utils";
import { answerSpeech, renderPane } from "./answerPane.harness";

// The activity channel dials a WebSocket at import time; a socket that never
// closes keeps its reconnect timer out of the file.
vi.hoisted(() => {
  class QuietSocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

vi.mock("../../speech/synth", async () => (await import("./answerPane.mocks")).synthMock());
vi.mock("../../markdown/MermaidDiagram", async () => (await import("./answerPane.mocks")).mermaidMock());
// The pane names its project through the tab's session list; pin it.
vi.mock("../sessionProject", () => ({ projectOfSession: () => "alpha" }));

const SESSION = "cell-a";
const ANSWER = "The answer explains why the migration has to finish before traffic moves.";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
});
afterEach(() => {
  cleanup();
  __resetAnswerWaitingForTests();
  __resetAnswerRetryForTests();
  resetActivityForTests();
  // Global, not per project: a test that switches the composer off must not
  // leave the next one without a field to focus.
  writePreference(preferences.answerComposerEnabled, true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What jsdom makes of a background value, so a test compares like with like. */
function normalized(background: string): string {
  const probe = document.createElement("div");
  probe.style.background = background;
  return probe.style.background;
}

const SOLID = normalized("#17171d");
const gradient = (n: number) =>
  normalized(
    `linear-gradient(to bottom, #17171d 0%, color-mix(in srgb, #17171d ${n}%, transparent) 100%)`,
  );

const pane = () => screen.getByTestId(`answer-pane-${SESSION}`);
const body = () => screen.getByTestId(`answer-pane-body-${SESSION}`);
const field = () => screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;
const wave = () => screen.queryByTestId(`answer-pane-wave-${SESSION}`);

function setOpacity(n: number): void {
  act(() => writePreference(preferences.answerOpacityBottom, n, "alpha"));
}

function mount(): void {
  renderPane(answerSpeech(ANSWER).speech);
}

describe("AnswerPane answer opacity", () => {
  it("opacity 100 renders the solid surface", () => {
    mount();
    expect(body().style.background).toBe(SOLID);
    expect(pane().style.background).toBe(SOLID);

    // Composer focused: still solid.
    act(() => field().focus());
    expect(body().style.background).toBe(SOLID);
    expect(pane().style.background).toBe(SOLID);

    // Waiting, wave on screen: still solid.
    act(() => beginWaiting(SESSION, "u-1"));
    expect(wave()).not.toBeNull();
    expect(body().style.background).toBe(SOLID);
    expect(pane().style.background).toBe(SOLID);
  });

  it("opacity below 100 paints the body gradient and keeps composer solid", () => {
    // Guard: if jsdom dropped the value, every comparison below would be "" to "".
    expect(SOLID).not.toBe("");
    expect(gradient(40)).toContain("linear-gradient");
    expect(gradient(40)).toContain("color-mix(in srgb, rgb(23, 23, 29) 40%, transparent) 100%");
    mount();
    expect(body().style.background).toBe(SOLID);
    // An open pane follows the preference at once.
    setOpacity(40);
    expect(body().style.background).toBe(gradient(40));
    // The pane itself is transparent behind the body.
    expect(pane().style.background).toBe("");
    expect(cssRule(".answer-pane")).toMatch(/background:\s*transparent/);
    // Meta row and composer rows keep the solid ground.
    for (const selector of [
      ".answer-pane-meta",
      ".answer-pane-composer",
      ".answer-pane-chip-row",
      ".answer-pane-grip",
      ".answer-pane-hint",
      ".answer-pane-drag",
      ".answer-pane-retry-row",
    ]) {
      expect([selector, cssRule(selector)]).toEqual([
        selector,
        expect.stringMatching(/background:\s*#17171d/),
      ]);
    }

    // At 0 the gradient ends fully transparent; the composer stays solid.
    setOpacity(0);
    expect(body().style.background).toBe(gradient(0));
    expect(gradient(0)).toContain("0%, transparent");
    expect(cssRule(".answer-pane-composer")).toMatch(/background:\s*#17171d/);
  });

  it("composer focus without a pending reply makes the body solid", () => {
    setOpacity(40);
    mount();
    expect(body().style.background).toBe(gradient(40));
    act(() => field().focus());
    expect(document.activeElement).toBe(field());
    expect(wave()).toBeNull();
    expect(body().style.background).toBe(SOLID);
    // Focus leaves the composer: the gradient is back.
    act(() => pane().focus());
    expect(body().style.background).toBe(gradient(40));
  });

  it("the waiting wave keeps the gradient even with composer focus", () => {
    setOpacity(40);
    mount();
    act(() => field().focus());
    expect(body().style.background).toBe(SOLID);
    act(() => beginWaiting(SESSION, "u-1"));
    expect(wave()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(body().style.background).toBe(gradient(40));
  });

  it("the held wave keeps the gradient even with composer focus", () => {
    setOpacity(40);
    mount();
    act(() => field().focus());
    expect(body().style.background).toBe(SOLID);
    // The user stepped back to an answer while the agent still works: the
    // wave moves above the text, and the pane is still saying "working".
    act(() => {
      holdAnswer(SESSION);
      _applyEventForTests({ sessionId: SESSION, state: "busy", at: 1 });
    });
    expect(document.activeElement).toBe(field());
    expect(body().style.background).toBe(gradient(40));
  });

  it("switching the composer off while its field is focused restores the gradient", () => {
    setOpacity(40);
    mount();
    act(() => field().focus());
    expect(body().style.background).toBe(SOLID);
    // The field unmounts with focus in it, which fires no blur.
    act(() => writePreference(preferences.answerComposerEnabled, false));
    expect(screen.queryByTestId(`answer-pane-composer-${SESSION}`)).toBeNull();
    expect(body().style.background).toBe(gradient(40));
  });

  it("an offered Retry Enter sits in a solid row of its own", () => {
    vi.useFakeTimers();
    setOpacity(40);
    mount();
    act(() => {
      armRetryOffer(SESSION, beginRetryTicket(SESSION));
    });
    act(() => {
      vi.advanceTimersByTime(RETRY_OFFER_MS);
    });
    const button = screen.getByTestId(`answer-pane-retry-enter-${SESSION}`);
    const row = button.parentElement as HTMLElement;
    // The button is not a bare child of the transparent pane: its gutter is
    // the row's padding, painted with the composer's ground.
    expect(row.classList.contains("answer-pane-retry-row")).toBe(true);
    expect(cssRule(".answer-pane-retry-row")).toMatch(/background:\s*#17171d/);
    expect(cssRule(".answer-pane-retry-row")).toMatch(/padding:\s*0 13px 7px/);
    expect(cssRule(".answer-pane-retry-enter")).not.toMatch(/margin/);
  });
});
