/**
 * The answer pane never closes on Escape. Only the eye and Alt+Shift+O close
 * it, so Escape always reaches the cell's terminal — a TUI that uses it
 * (Claude Code interrupts on it) is never one keystroke behind the pane. An
 * Escape pressed while focus sits in the pane is handed to the cell's PTY and
 * focus goes back to its xterm, unless something inside the pane (the command
 * picker, a wiki hover card) consumed it first.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubResizeObserver, installMatchMedia } from "../../../test-utils";
import {
  CELLS,
  cellsHost,
  eyeOf,
  paneOf,
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

const { forgetAnswerPane } = await import("../answerPaneState");
const { inputSent, resetInputSent } = await import("./answerPane.mocks");

beforeEach(() => {
  resetInputSent();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
  for (const id of CELLS) forgetAnswerPane(id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the answer pane and Escape", () => {
  it("escape never closes the pane and reaches the focused terminal", async () => {
    const { speech } = cellsHost();
    renderCells(speech);
    await settleCells();
    for (const id of CELLS) fireEvent.click(eyeOf(id));
    const openA = paneOf("cell-a");
    expect(openA).not.toBeNull();
    expect(paneOf("cell-b")).not.toBeNull();

    // In the cell's own terminal, and in another cell's: the key is not
    // cancelled, it reaches that terminal's textarea, and no pane closes.
    for (const id of CELLS) {
      const reached = terminalKeys(id);
      terminalOf(id).focus();
      expect(fireEvent.keyDown(terminalOf(id), { key: "Escape" })).toBe(true);
      expect(reached).toHaveBeenCalledTimes(1);
      expect(paneOf("cell-a")).not.toBeNull();
      expect(paneOf("cell-b")).not.toBeNull();
    }

    // In the pane itself.
    openA!.focus();
    fireEvent.keyDown(openA!, { key: "Escape" });
    expect(paneOf("cell-a")).not.toBeNull();

    // With no focus at all.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
    expect(paneOf("cell-a")).not.toBeNull();
    expect(paneOf("cell-b")).not.toBeNull();
  });

  it("escape in the pane bubbles out to its ancestors", async () => {
    const { speech } = cellsHost();
    renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    const pane = paneOf("cell-a")!;
    expect(pane).not.toBeNull();

    // A listener above the whole React tree: a stopPropagation anywhere on the
    // pane's path would keep the key from reaching it.
    const ancestor = vi.fn();
    document.addEventListener("keydown", ancestor);
    try {
      pane.focus();
      expect(fireEvent.keyDown(pane, { key: "Escape" })).toBe(true);
      // From inside the pane too, not only its root.
      const body = pane.querySelector<HTMLElement>(".answer-pane-body")!;
      expect(fireEvent.keyDown(body, { key: "Escape" })).toBe(true);
      expect(ancestor).toHaveBeenCalledTimes(2);
      expect(ancestor.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual([
        "Escape",
        "Escape",
      ]);
    } finally {
      document.removeEventListener("keydown", ancestor);
    }
    expect(paneOf("cell-a")).not.toBeNull();
  });

  it("escape in the pane goes to the cell's terminal and the pane stays open", async () => {
    const { speech } = cellsHost();
    renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    const pane = paneOf("cell-a")!;
    expect(document.activeElement).toBe(pane);
    resetInputSent();

    fireEvent.keyDown(pane, { key: "Escape" });

    expect(inputSent.get("cell-a")).toEqual(["\x1b"]);
    expect(inputSent.get("cell-b")).toBeUndefined();
    expect(document.activeElement).toBe(terminalOf("cell-a"));
    expect(paneOf("cell-a")).not.toBeNull();
  });

  it("escape from inside the pane's body goes to the terminal too", async () => {
    const { speech } = cellsHost();
    renderCells(speech);
    await settleCells();
    fireEvent.click(eyeOf("cell-a"));
    resetInputSent();
    const body = paneOf("cell-a")!.querySelector<HTMLElement>(".answer-pane-body")!;

    fireEvent.keyDown(body, { key: "Escape" });

    expect(inputSent.get("cell-a")).toEqual(["\x1b"]);
    expect(document.activeElement).toBe(terminalOf("cell-a"));
  });

  it("an escape the command picker consumes reaches no terminal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })),
    );
    try {
      const { speech } = cellsHost();
      renderCells(speech);
      await settleCells();
      fireEvent.click(eyeOf("cell-a"));
      const field = screen.getByTestId("answer-pane-composer-cell-a");
      field.focus();
      fireEvent.click(screen.getByTestId("answer-pane-skills-chip-cell-a"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.queryByRole("listbox")).not.toBeNull();
      resetInputSent();

      fireEvent.keyDown(field, { key: "Escape" });

      expect(screen.queryByRole("listbox")).toBeNull();
      expect(inputSent.get("cell-a")).toBeUndefined();
      expect(document.activeElement).toBe(field);
      expect(paneOf("cell-a")).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
