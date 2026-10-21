/**
 * The shared setup of the answer pane and composer family: speech hosts,
 * renders and markdown fixtures. The module-mock factories live one file over,
 * in `answerPane.mocks.tsx`, and are re-exported here.
 *
 * Why two files: this one imports `AnswerPane`, which reaches the very modules
 * the factories stand in for. A factory that loaded THIS module would wait on
 * its own evaluation — the run hangs — so the factories sit in a module that
 * imports nothing from the app, and each test file delegates to it lazily:
 *
 *   vi.mock("../../markdown/MermaidDiagram", async () =>
 *     (await import("./answerPane.mocks")).mermaidMock());
 *
 * A static import of a factory does not survive the hoist (`vi.mock` runs
 * before the binding exists); the dynamic import inside the factory does.
 *
 * Neither module holds a `describe`/`it`, and both are outside vitest's
 * `*.test.*` include, so neither is collected on its own.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import { makeSpeech } from "../../speech/__tests__/speech.harness";
import { prepare } from "../../speech/prepare";
import type { GridSpeech, SpeechUnit } from "../../speech/types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { AnswerComposer, type AnswerComposerProps } from "../AnswerComposer";
import { AnswerPane, type AnswerPaneProps } from "../AnswerPane";

export { mermaidMock, pool, resetPool, synthMock, terminalInstancesMock } from "./answerPane.mocks";

// ---------------------------------------------------------------------------
// Speech hosts
// ---------------------------------------------------------------------------

/**
 * A READY host whose commands are spies: the speech harness's `makeSpeech`
 * with the one default this family differs on — a pane is opened on a cell
 * that has an answer to read, so `stateFor` is `ready`, not `empty`. With no
 * overrides nothing is under the cursor, so the markdown renderer is never
 * mounted; pass `queueFor` / `unitsFor` (or use `answerSpeech`) to put an
 * answer there.
 */
export function readySpeech(overrides: Partial<GridSpeech> = {}): GridSpeech {
  // Only the `GridSpeech` half: the members a `SpeechHost` adds for the
  // document-wide transport are no part of a pane's host, and a suite that
  // walks the host's functions (`AnswerPane.waiting`'s "touches nothing")
  // would otherwise meet functions that are not spies.
  const {
    speakingSessionId: _speaking,
    pausedSessionId: _paused,
    autoplaySessionIds: _autoplay,
    oldestUnheardArrival: _oldest,
    lastSpokenSessionId: _lastSpoken,
    onSeekBackward: _seekBackward,
    preparingSessionIds: _preparing,
    ...grid
  } = makeSpeech({ stateFor: () => "ready", ...overrides });
  return grid;
}

/** One answer under the cursor of `sessionId`, as the queue's own reducer files it. */
export function answerQueue(markdown: string, sessionId = "cell-a"): UtteranceQueue {
  return utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance: { id: "u-1", sessionId, text: markdown, at: 1 },
    speaking: false,
  });
}

/**
 * A ready host with `markdown` under the cursor and its real `prepare()`
 * units — the reads are spies, so a test can assert what the pane asked for.
 */
export function answerSpeech(
  markdown: string,
  overrides: Partial<GridSpeech> = {},
): { speech: GridSpeech; units: readonly SpeechUnit[] } {
  const queue = answerQueue(markdown);
  const units = prepare(markdown).units;
  const speech = readySpeech({
    stateFor: vi.fn(() => "ready" as const),
    queueFor: vi.fn(() => queue),
    unitsFor: vi.fn(() => units),
    progressFor: vi.fn(() => null),
    ...overrides,
  });
  return { speech, units };
}

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

/**
 * The pane for `cell-a` on a live socket, inside the router the markdown
 * renderer needs (it links with `useNavigate`). Props override per test.
 */
export function renderPane(speech: GridSpeech, props: Partial<AnswerPaneProps> = {}) {
  return render(
    <MemoryRouter>
      <AnswerPane
        sessionId="cell-a"
        speech={speech}
        onClose={() => {}}
        send={() => true}
        {...props}
      />
    </MemoryRouter>,
  );
}

/**
 * The composer's `onSubmitted`, one spy for every file that renders it alone.
 * Each file clears it in its own `beforeEach`.
 */
export const onSubmitted = vi.fn();

/** The composer alone, for `cell-a`, writing through `send`. Props override per test. */
export function renderComposer(
  send: (data: string) => boolean = () => true,
  props: Partial<AnswerComposerProps> = {},
) {
  return render(
    <AnswerComposer sessionId="cell-a" send={send} onSubmitted={onSubmitted} {...props} />,
  );
}

// ---------------------------------------------------------------------------
// Markdown fixtures
// ---------------------------------------------------------------------------

/** A heading, a link and a fence: the three things a rendered copy would lose. */
export const COPY_MARKDOWN = [
  "# Deploy plan",
  "",
  "Read [the deploy guide](https://example.com/deploy) before the migration starts.",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
].join("\n");
