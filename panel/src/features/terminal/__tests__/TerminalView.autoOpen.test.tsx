/**
 * The sticky hide and the Alt+Shift+O toggle. A pane the user closed (eye or
 * Alt+Shift+O) is hidden by choice: new answers do not reopen it until the
 * user shows it again. Per session and in memory, so a reload forgets it.
 *
 * Two cells throughout, because both rules are per cell: Alt+Shift+O toggles
 * the FOCUSED cell's pane only, although every cell is listening on `window`.
 */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import { StubResizeObserver, installMatchMedia } from "../../../test-utils";
import {
  CELLS,
  cellsGrid,
  cellsHost,
  eyeOf,
  paneOf,
  pressAltShiftO,
  renderCells,
  settleCells,
  terminalKeys,
  terminalOf,
} from "./answerPaneCells.harness";

vi.mock("../terminalInstances", async () =>
  (await import("./answerPane.mocks")).terminalViewInstancesMock(),
);
vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));
vi.mock("../../markdown/MermaidDiagram", async () => (await import("./answerPane.mocks")).mermaidMock());
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  ...(await import("./answerPane.mocks")).synthMock(),
}));

const { forgetAnswerPane, getAnswerPaneState } = await import("../answerPaneState");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
  for (const id of CELLS) forgetAnswerPane(id);
  setStoredAutoOpenAnswer(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Alt+Shift+O", () => {
  it("Alt+Shift+O toggles the focused cell's pane", async () => {
    const { speech } = cellsHost();
    renderCells(speech, { focusedId: "cell-b" });
    await settleCells();
    // The focused cell's terminal took DOM focus on mount.
    expect(document.activeElement).toBe(terminalOf("cell-b"));
    const shellB = terminalKeys("cell-b");

    // From the focused terminal: only that cell opens, and the shell never
    // sees the key.
    expect(pressAltShiftO(terminalOf("cell-b"))).toBe(false);
    expect(shellB).not.toHaveBeenCalled();
    expect(paneOf("cell-b")).not.toBeNull();
    expect(paneOf("cell-a")).toBeNull();

    // An auto-repeat of the held key is ignored: no flicker.
    pressAltShiftO(document.activeElement ?? document.body, { repeat: true });
    expect(paneOf("cell-b")).not.toBeNull();

    // From inside the open pane (it took focus): closes it — a user close.
    expect(paneOf("cell-b")!.contains(document.activeElement)).toBe(true);
    pressAltShiftO(document.activeElement!);
    expect(paneOf("cell-b")).toBeNull();
    expect(paneOf("cell-a")).toBeNull();
    expect(getAnswerPaneState("cell-b").hiddenByChoice).toBe(true);

    // DOM focus in the other cell's terminal: that cell is the focused one.
    const shellA = terminalKeys("cell-a");
    terminalOf("cell-a").focus();
    pressAltShiftO(terminalOf("cell-a"));
    expect(shellA).not.toHaveBeenCalled();
    expect(paneOf("cell-a")).not.toBeNull();
    expect(paneOf("cell-b")).toBeNull();

    // No DOM focus at all: the grid's focused cell answers.
    (document.activeElement as HTMLElement | null)?.blur();
    pressAltShiftO(document.body);
    expect(paneOf("cell-b")).not.toBeNull();
    expect(paneOf("cell-a")).not.toBeNull();
    expect(getAnswerPaneState("cell-b").hiddenByChoice).toBe(false);
  });

  it("the eye is a user toggle too", async () => {
    const { speech } = cellsHost();
    renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    expect(getAnswerPaneState("cell-a")).toEqual({ open: true, hiddenByChoice: false });
    fireEvent.click(eyeOf("cell-a"));
    expect(getAnswerPaneState("cell-a")).toEqual({ open: false, hiddenByChoice: true });
  });
});

describe("a pane hidden by choice", () => {
  it("a pane hidden by choice is not reopened by a new answer", async () => {
    const { speech, arrive } = cellsHost();
    const view = renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    fireEvent.click(eyeOf("cell-a"));
    expect(paneOf("cell-a")).toBeNull();

    arrive("cell-a");
    view.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).toBeNull();
  });

  it("showing the pane again restores auto-open", async () => {
    const { speech, arrive } = cellsHost();
    const view = renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    fireEvent.click(eyeOf("cell-a"));
    // Shown again, then closed by a non-choice (the bar hidden and back).
    fireEvent.click(eyeOf("cell-a"));
    expect(paneOf("cell-a")).not.toBeNull();
    view.rerender(cellsGrid(speech, { speechBarVisible: false }));
    view.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).toBeNull();

    arrive("cell-a");
    view.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).not.toBeNull();
  });

  it("hidden-by-choice is per session", async () => {
    const { speech, arrive } = cellsHost();
    const view = renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    fireEvent.click(eyeOf("cell-a"));

    arrive("cell-a");
    arrive("cell-b");
    view.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).toBeNull();
    expect(paneOf("cell-b")).not.toBeNull();
  });

  it("hiding the speech bar is not a choice to hide the pane", async () => {
    const { speech, arrive } = cellsHost();
    const view = renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    expect(paneOf("cell-a")).not.toBeNull();

    view.rerender(cellsGrid(speech, { speechBarVisible: false }));
    expect(paneOf("cell-a")).toBeNull();
    expect(getAnswerPaneState("cell-a").hiddenByChoice).toBe(false);

    view.rerender(cellsGrid(speech));
    arrive("cell-a");
    view.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).not.toBeNull();
  });

  it("a reload hides nothing by choice", async () => {
    const { speech, arrive } = cellsHost();
    const view = renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    fireEvent.click(eyeOf("cell-a"));
    view.unmount();

    // A reload drops every in-memory entry; a fresh tab starts from defaults.
    act(() => {
      for (const id of CELLS) forgetAnswerPane(id);
    });
    const fresh = renderCells(speech);
    await settleCells();
    expect(getAnswerPaneState("cell-a").hiddenByChoice).toBe(false);
    arrive("cell-a");
    fresh.rerender(cellsGrid(speech));
    expect(paneOf("cell-a")).not.toBeNull();
  });
});
