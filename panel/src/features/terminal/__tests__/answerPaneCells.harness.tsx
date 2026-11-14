/**
 * Two whole cells side by side, each a `TerminalView` with its speech row and
 * its answer pane, for the suites about how the cells' panes and terminals
 * share the keyboard and the arrivals.
 *
 * A file using this must mock the pool with `terminalViewInstancesMock`
 * (see `answerPane.mocks.tsx`), so each cell's holder carries an xterm
 * textarea a key can be pressed in:
 *
 *   vi.mock("../terminalInstances", async () =>
 *     (await import("./answerPane.mocks")).terminalViewInstancesMock());
 *
 * Not a `*.test.*` file, so vitest never collects it on its own.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { prepare } from "../../speech/prepare";
import type { GridSpeech } from "../../speech/types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { TerminalView } from "../TerminalView";
import { readySpeech } from "./answerPane.harness";

export const CELLS = ["cell-a", "cell-b"] as const;
export type CellId = (typeof CELLS)[number];

const MARKDOWN = "# Deploy plan\n\nThe migration has to finish before traffic moves.\n";

/**
 * A ready host with one answer already under every cell's cursor — old news,
 * which seeds each cell's seen set — and `arrive` to file a NEW one for a
 * cell. After an `arrive` the grid has to be re-rendered (`rerender`) so the
 * cell is handed the new queue reference, which is all it sees of an arrival.
 */
export function cellsHost(): { speech: GridSpeech; arrive: (sessionId: CellId) => void } {
  let at = 1;
  const queues = new Map<string, UtteranceQueue>();
  const file = (sessionId: string, base: UtteranceQueue): UtteranceQueue => {
    const id = `${sessionId}-u-${at}`;
    const next = utteranceQueueReducer(base, {
      type: "arrived",
      utterance: { id, sessionId, text: MARKDOWN, at: at++ },
      speaking: false,
    });
    queues.set(sessionId, next);
    return next;
  };
  const queueOf = (sessionId: string): UtteranceQueue =>
    queues.get(sessionId) ?? file(sessionId, emptyUtteranceQueue);
  const units = prepare(MARKDOWN).units;
  const speech = readySpeech({
    queueFor: (sessionId: string) => queueOf(sessionId),
    unitsFor: () => units,
    progressFor: () => null,
  });
  return {
    speech,
    arrive: (sessionId) => {
      file(sessionId, queueOf(sessionId));
    },
  };
}

/**
 * Both cells, `focusedId` the grid's focused one. `speechBarVisible` sets
 * every cell's speech row; `hiddenRows` hides the row of just those cells.
 */
export function cellsGrid(
  speech: GridSpeech,
  {
    focusedId = "cell-b",
    speechBarVisible = true,
    hiddenRows = [],
  }: { focusedId?: CellId; speechBarVisible?: boolean; hiddenRows?: readonly CellId[] } = {},
) {
  return (
    <MemoryRouter>
      {CELLS.map((id) => (
        <div key={id} data-testid={`grid-cell-${id}`}>
          <TerminalView
            sessionId={id}
            speech={speech}
            focused={id === focusedId}
            speechBarVisible={speechBarVisible && !hiddenRows.includes(id)}
          />
        </div>
      ))}
    </MemoryRouter>
  );
}

export function renderCells(speech: GridSpeech, options?: Parameters<typeof cellsGrid>[1]) {
  return render(cellsGrid(speech, options));
}

/** Lets the mount effect's rAF (the focused cell's focus) and its settle timer run. */
export async function settleCells(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

export const paneOf = (id: CellId): HTMLElement | null => screen.queryByTestId(`answer-pane-${id}`);
export const eyeOf = (id: CellId): HTMLElement => screen.getByTestId(`speech-bar-eye-${id}`);
export const terminalOf = (id: CellId): HTMLElement => screen.getByLabelText(`terminal input ${id}`);

/** A spy on what reached the cell's xterm textarea — the shell receiving the key. */
export function terminalKeys(id: CellId): ReturnType<typeof vi.fn> {
  const reached = vi.fn();
  terminalOf(id).addEventListener("keydown", reached);
  return reached;
}

/** Alt+Shift+O on `target`; true when nothing cancelled it (fireEvent's own contract). */
export function pressAltShiftO(target: Element, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(target, {
    key: "Ø",
    code: "KeyO",
    altKey: true,
    shiftKey: true,
    ...init,
  });
}
