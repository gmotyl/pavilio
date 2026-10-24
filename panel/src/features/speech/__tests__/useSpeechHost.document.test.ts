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
// The real vote, counted: a page's language is voted once per utterance, not
// on every render that asks for its units.
vi.mock("../language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../language")>();
  return { ...actual, voteLanguage: vi.fn(actual.voteLanguage) };
});

import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";
import { voiceForSession } from "../../terminal/sessionVoice";
import { docSpeechKey } from "../docKey";
import { voteLanguage } from "../language";
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

  it("a page's language is voted once per utterance", async () => {
    const text = response(3, "Page");
    const host = renderHost();
    const votes = () =>
      vi.mocked(voteLanguage).mock.calls.filter(([voted]) => voted === text).length;
    await settle(() => host().speakDocument({ key: PAGE, text }));
    // The channel's own tally votes on arrival; that is per arrival, not per ask.
    const landed = votes();
    expect(host().unitsFor(PAGE).length).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) host().unitsFor(PAGE);
    await endCurrentUnit();
    host().unitsFor(PAGE);

    expect(votes()).toBe(landed);
  });

  it("a page's frontmatter is not spoken", async () => {
    const body = response(2, "Hello");
    const host = renderHost();

    await settle(() =>
      host().speakDocument({ key: PAGE, text: `---\ntitle: X\ntags: [a]\n---\n${body}` }),
    );

    // Spoken exactly as the body alone would be, and landed as the body: an
    // edit to the frontmatter alone is not a new utterance.
    expect(host().unitsFor(PAGE).map((unit) => unit.text)).toEqual(unitsOf(body));
    expect(requestedTexts()[0]).toBe(unitsOf(body)[0]);
    const landed = utteranceUnderCursor(host().queueFor(PAGE));
    expect(landed?.text).toBe(body);

    await settle(() => host().stopDocument(PAGE));
    await settle(() =>
      host().speakDocument({ key: PAGE, text: `---\ntitle: Y\nauthor: Z\n---\n${body}` }),
    );
    expect(utteranceUnderCursor(host().queueFor(PAGE))?.id).toBe(landed?.id);
  });

  it("a page that is only frontmatter has nothing to say", async () => {
    const host = renderHost();

    await settle(() => host().speakDocument({ key: PAGE, text: "---\ntitle: X\n---\n" }));

    expect(host().stateFor(PAGE)).toBe("empty");
    expect(requestedTexts()).toEqual([]);
  });

  it("two pages with the same text land distinct utterances", async () => {
    const text = response(2, "Same");
    const other = docSpeechKey("q/wiki/page.md");
    const host = renderHost();

    await settle(() => host().speakDocument({ key: PAGE, text }));
    await settle(() => host().speakDocument({ key: other, text }));

    const first = utteranceUnderCursor(host().queueFor(PAGE))?.id;
    const second = utteranceUnderCursor(host().queueFor(other))?.id;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
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

  it("speakDocument with new text while playing replaces the run", async () => {
    const host = renderHost();
    await settle(() => host().speakDocument({ key: PAGE, text: response(3, "Old") }));
    expect(host().speakingSessionId).toBe(PAGE);

    const text = response(2, "New");
    await settle(() => host().speakDocument({ key: PAGE, text }));

    // The new text is the key's one utterance, under the cursor — not queued
    // behind a run the drop already forgot.
    const queue = host().queueFor(PAGE);
    expect(queue.current?.text).toBe(text);
    expect(queue.pending).toEqual([]);
    expect(host().unitsFor(PAGE).map((unit) => unit.text)).toEqual(unitsOf(text));
    expect(host().stateFor(PAGE)).toBe("speaking");
    expect(host().speakingSessionId).toBe(PAGE);
  });

  it("a replaced page text coming back warms afresh", async () => {
    const old = response(3, "Old");
    const host = renderHost();
    await settle(() => host().speakDocument({ key: PAGE, text: old }));
    await settle(() => host().speakDocument({ key: PAGE, text: response(2, "New") }));

    // The replace called the old warm off, so the old text's return must not
    // trust it: with nothing left in the synth cache, unit 0 is warmed again
    // and the key is red until it lands.
    synth.reset();
    synth.hold(unitsOf(old)[0]);
    await settle(() => host().speakDocument({ key: PAGE, text: old }));

    expect(synth.requests[0]).toMatchObject({ text: unitsOf(old)[0], tier: "warm" });
    expect(host().preparingSessionIds.has(PAGE)).toBe(true);
  });

  it("speakDocument with nothing to say while playing stops the old run", async () => {
    const host = renderHost();
    await settle(() => host().speakDocument({ key: PAGE, text: response(3, "Old") }));
    expect(host().speakingSessionId).toBe(PAGE);

    await settle(() => host().speakDocument({ key: PAGE, text: "```\ncode only\n```" }));

    expect(host().speakingSessionId).toBeNull();
    expect(host().queueFor(PAGE).current).toBeNull();
    expect(host().stateFor(PAGE)).toBe("empty");
  });

  it("stopDocument while unit 0 is warming clears preparing", async () => {
    const text = response(2, "Page");
    synth.hold(unitsOf(text)[0]);
    const host = renderHost();
    await settle(() => host().speakDocument({ key: PAGE, text }));
    expect(host().preparingSessionIds.has(PAGE)).toBe(true);

    await settle(() => host().stopDocument(PAGE));

    expect(host().preparingSessionIds.has(PAGE)).toBe(false);
    expect(host().stateFor(PAGE)).toBe("empty");
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
