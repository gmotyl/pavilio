/**
 * Page speech, seen from the host.
 *
 * A page is one more speech source in the one host, keyed `doc:<path>`: its
 * utterance is built in the browser and landed locally, then spoken through
 * the same ladder as an answer. These tests drive the real channel and the
 * real player through `useSpeechHost`, as the core suite does, and assert on
 * what the host reports and what it hands to synthesis.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitUtterance,
  endCurrentUnit,
  played,
  requestedTexts,
  resetSpeechHarness,
  response,
  settle,
  synth,
  synthMock,
  unitsOf,
  useWebSocketMock,
} from "./speech.harness";

vi.mock("../synth", () => synthMock());
vi.mock("../../realtime/useWebSocket", () => useWebSocketMock());

import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";
import { voiceForSession } from "../../terminal/sessionVoice";
import { docSpeechKey } from "../docKey";
import { prepare } from "../prepare";
import { useSpeechHost, type SpeechHost } from "../useSpeechHost";
import { utteranceUnderCursor } from "../utteranceQueue";
import { setProjectVoice } from "../voices";
import { storeAnswerWaiting } from "./answerWaitingPort";

const EMMA = "en-US-EmmaMultilingualNeural";
const PAGE = docSpeechKey("p/wiki/page.md");

function renderHost(onAnswer = vi.fn()) {
  const { result } = renderHook(() =>
    useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting, onAnswer }),
  );
  return (): SpeechHost => result.current;
}

/** Puts a cell in autoplay: two clicks forward from off, the second the gesture. */
async function autoplay(host: () => SpeechHost, sessionId: string): Promise<void> {
  await settle(() => {
    host().cycleSpeechMode(sessionId); // armed
    host().cycleSpeechMode(sessionId); // autoplay
  });
}

beforeEach(() => {
  resetSpeechHarness();
  __resetAlertsForTests();
});

describe("useSpeechHost — page speech", () => {
  it("speakDocument lands a local utterance and starts it", async () => {
    setProjectVoice("p", EMMA);
    const text = response(3, "Page");
    const units = unitsOf(text);
    synth.hold(units[0]);
    const host = renderHost();

    await settle(() => host().speakDocument({ key: PAGE, text }));

    const landed = utteranceUnderCursor(host().queueFor(PAGE));
    expect(landed?.sessionId).toBe(PAGE);
    expect(landed?.text).toBe(text);
    // Unit 0 is asked for at once, in the page's project voice, and the key
    // stays red until it is in hand.
    expect(requestedTexts()[0]).toBe(units[0]);
    expect(synth.requests[0]?.voice).toBe(EMMA);
    expect(host().preparingSessionIds.has(PAGE)).toBe(true);
    expect(played).toEqual([]);

    await settle(() => synth.release(units[0]));

    expect(host().preparingSessionIds.has(PAGE)).toBe(false);
    expect(host().speakingSessionId).toBe(PAGE);
    expect(host().stateFor(PAGE)).toBe("speaking");
    expect(played).toHaveLength(1);
    // The id is the text's hash: the same text lands as the same utterance.
    await settle(() => host().stopDocument(PAGE));
    await settle(() => host().speakDocument({ key: PAGE, text }));
    expect(utteranceUnderCursor(host().queueFor(PAGE))?.id).toBe(landed?.id);
    await settle(() => host().stopDocument(PAGE));
    await settle(() => host().speakDocument({ key: PAGE, text: response(3, "Other") }));
    expect(utteranceUnderCursor(host().queueFor(PAGE))?.id).not.toBe(landed?.id);
  });

  it("speakDocument prepares with the page's own language", async () => {
    // Polish by its diacritics. One Polish vote never switches a channel tally
    // on (it takes two), so a tally-prepared page would be read as English.
    const text = "Zażółć gęślą jaźń: zrób deploy i build na `main` w `src/app.ts`.";
    const polish = prepare(text, { language: "pl" }).units.map((unit) => unit.text);
    const english = prepare(text, { language: "en" }).units.map((unit) => unit.text);
    expect(polish).not.toEqual(english);
    const host = renderHost();

    await settle(() => host().speakDocument({ key: PAGE, text }));

    expect(host().unitsFor(PAGE).map((unit) => unit.text)).toEqual(polish);
    expect(requestedTexts()[0]).toBe(polish[0]);
  });

  it("a manual cell speak stops the page run", async () => {
    const host = renderHost();
    await emitUtterance("cell-a", "u-1", response(2, "Cell"));
    await settle(() => host().speakDocument({ key: PAGE, text: response(2, "Page") }));
    expect(host().stateFor(PAGE)).toBe("speaking");

    await settle(() => host().onSpeak("cell-a"));

    expect(host().speakingSessionId).toBe("cell-a");
    expect(host().stateFor(PAGE)).not.toBe("speaking");
  });

  it("autoplay answer waits behind a page run", async () => {
    const host = renderHost();
    await autoplay(host, "cell-a");
    const page = response(2, "Page");
    await settle(() => host().speakDocument({ key: PAGE, text: page }));
    const before = played.length;

    await emitUtterance("cell-a", "u-1", response(1, "Answer"));

    // The page keeps the element; the answer is owed, not spoken.
    expect(host().speakingSessionId).toBe(PAGE);
    expect(played).toHaveLength(before);

    for (let i = 0; i < unitsOf(page).length; i += 1) await endCurrentUnit();

    expect(host().speakingSessionId).toBe("cell-a");
  });

  it("stopDocument stops and drops the page", async () => {
    const host = renderHost();
    await settle(() => host().speakDocument({ key: PAGE, text: response(2, "Page") }));
    expect(host().speakingSessionId).toBe(PAGE);

    await settle(() => host().stopDocument(PAGE));

    expect(host().speakingSessionId).toBeNull();
    expect(host().queueFor(PAGE).current).toBeNull();
    expect(host().stateFor(PAGE)).toBe("empty");

    // Another key's stop leaves a run it does not own alone.
    await emitUtterance("cell-a", "u-1", response(2, "Cell"));
    await settle(() => host().onSpeak("cell-a"));
    await settle(() => host().stopDocument(docSpeechKey("p/other.md")));
    expect(host().speakingSessionId).toBe("cell-a");
  });

  it("a page utterance raises no answer alert", async () => {
    const onAnswer = vi.fn();
    const host = renderHost(onAnswer);

    await settle(() => host().speakDocument({ key: PAGE, text: response(2, "Page") }));
    await endCurrentUnit();

    expect(onAnswer).not.toHaveBeenCalled();
    expect(getAlertsSnapshot()).toEqual([]);
    // Nothing the page did lands in a cell's queue.
    expect(host().queueFor("cell-a").current).toBeNull();
  });
});
