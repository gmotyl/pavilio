/**
 * `SpeechRow` — the one speech row both surfaces render through: the cell's
 * `SpeechControlBar` and the page's `DocumentSpeechBar` fill its lead, trail
 * and middle slots, and the row owns the wrapper, the gesture isolation and
 * the transport wired to the host by `speechKey`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeSpeech } from "./speech.harness";
import type { Utterance } from "../types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../utteranceQueue";

vi.mock("../../terminal/terminalInstances", () => ({
  acquireTerminal: () => {
    throw new Error("the row must not acquire a terminal");
  },
  releaseTerminal: () => {},
  sendDismiss: () => {},
  THEME: new Proxy({}, { get: () => "#000000" }),
  followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
}));

// Everything cold, nothing notifies: the segments are not this file's subject.
vi.mock("../synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so they pick them up.
const { SpeechRow } = await import("../SpeechRow");
const { SpeechControlBar } = await import("../../terminal/SpeechControlBar");
const { refreshSessions } = await import("../../terminal/sessionStore");

const KEY = "cell-a";

describe("SpeechRow", () => {
  it("speech row renders lead, transport, extra and trail in order", () => {
    render(
      <SpeechRow
        speechKey={KEY}
        speech={makeSpeech()}
        voice="test-voice"
        testIdPrefix="speech-bar"
        lead={<button type="button" data-testid="lead" />}
        middleExtra={<span data-testid="extra" />}
        trail={<button type="button" data-testid="trail" />}
      />,
    );

    const row = screen.getByTestId(`speech-bar-${KEY}`).querySelector(".speech-bar-row");
    expect(row).not.toBeNull();
    const order = [
      "lead",
      `speech-bar-playpause-${KEY}`,
      `speech-bar-scrubber-${KEY}`,
      "extra",
      "trail",
    ].map((id) => screen.getByTestId(id));
    for (const el of order) expect(row!.contains(el)).toBe(true);
    // The lead is set off from the transport by the row's own separator.
    const afterLead = screen.getByTestId("lead").nextElementSibling;
    expect(afterLead?.classList.contains("speech-bar-sep")).toBe(true);
    expect(afterLead?.parentElement).toBe(row);
    for (let i = 1; i < order.length; i += 1) {
      // DOCUMENT_POSITION_FOLLOWING: the later id sits after the earlier one.
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("speech row stops pointer events reaching its container", () => {
    const onMouseDown = vi.fn();
    const onDragStart = vi.fn();
    const onClick = vi.fn();
    render(
      <div onMouseDown={onMouseDown} onDragStart={onDragStart} onClick={onClick}>
        <SpeechRow
          speechKey={KEY}
          speech={makeSpeech()}
          voice="test-voice"
          testIdPrefix="speech-bar"
          lead={<button type="button" data-testid="lead" />}
          trail={null}
        />
      </div>,
    );

    const lead = screen.getByTestId("lead");
    fireEvent.mouseDown(lead);
    fireEvent.click(lead);
    const drag = createEvent.dragStart(lead);
    fireEvent(lead, drag);

    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(drag.defaultPrevented).toBe(true);
    expect(screen.getByTestId(`speech-bar-${KEY}`).getAttribute("draggable")).toBe("false");
  });

  it("a cell's row places the rate button after the scrubber", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          { id: KEY, name: KEY, project: "p", cwd: "/srv/git/p", pid: 1, createdAt: "" },
        ],
      })),
    );
    try {
      await refreshSessions();
    } finally {
      vi.unstubAllGlobals();
    }
    render(
      <SpeechControlBar
        sessionId={KEY}
        speech={makeSpeech({ stateFor: () => "empty" })}
        answerOpen={false}
        onToggleAnswer={() => {}}
        send={() => true}
      />,
    );

    const row = screen.getByTestId(`speech-bar-${KEY}`).querySelector(".speech-bar-row")!;
    const els = [
      `speech-bar-autoplay-${KEY}`,
      `speech-bar-playpause-${KEY}`,
      `speech-bar-scrubber-${KEY}`,
      "speech-bar-rate-p",
      `speech-bar-launchers-${KEY}`,
      `speech-bar-eye-${KEY}`,
    ].map((id) => screen.getByTestId(id));
    for (const el of els) expect(row.contains(el)).toBe(true);
    for (let i = 1; i < els.length; i += 1) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("cell row keeps its controls through the shared row", () => {
    const waiting: Utterance = {
      id: "u-1",
      sessionId: KEY,
      text: "Queued.",
    } as unknown as Utterance;
    const queue: UtteranceQueue = { ...emptyUtteranceQueue, pending: [waiting] };
    render(
      <SpeechControlBar
        sessionId={KEY}
        // A silent cell (`empty`) with one answer waiting: the launchers and
        // the queue pill are both on the row at once.
        speech={makeSpeech({ stateFor: () => "empty", queueFor: () => queue })}
        answerOpen={false}
        onToggleAnswer={() => {}}
        send={() => true}
      />,
    );

    const bar = screen.getByTestId(`speech-bar-${KEY}`);
    const row = bar.querySelector(".speech-bar-row");
    expect(row).not.toBeNull();
    const ids = [
      `speech-bar-autoplay-${KEY}`,
      `speech-bar-previous-${KEY}`,
      `speech-bar-playpause-${KEY}`,
      `speech-bar-next-${KEY}`,
      `speech-bar-scrubber-${KEY}`,
      `speech-bar-launchers-${KEY}`,
      `speech-bar-eye-${KEY}`,
      `speech-bar-queue-${KEY}`,
    ];
    const els = ids.map((id) => screen.getByTestId(id));
    for (const el of els) expect(row!.contains(el)).toBe(true);
    for (let i = 1; i < els.length; i += 1) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByTestId(`speech-bar-previous-${KEY}`).getAttribute("aria-label")).toBe(
      "Previous answer",
    );
    expect(screen.getByTestId(`speech-bar-next-${KEY}`).getAttribute("aria-label")).toBe(
      "Next answer",
    );
    expect(screen.getByTestId(`speech-bar-eye-${KEY}`).getAttribute("aria-label")).toBe(
      "Answer, nothing spoken yet",
    );
    expect(screen.getByTestId(`speech-bar-queue-${KEY}`).textContent).toBe("+1");

    // The row markup lives in `SpeechRow` alone; the cell bar only fills slots.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "..", "terminal", "SpeechControlBar.tsx"), "utf8");
    expect(source).not.toMatch(/className="speech-bar-row"/);
    expect(source).not.toMatch(/className="speech-bar"/);
  });
});
