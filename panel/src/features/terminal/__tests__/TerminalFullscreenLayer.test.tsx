/**
 * What a fullscreen layer shows, on a real `TerminalsSurface` with real cells:
 * the toolbar, the grid, each `TerminalView` with its speech row and answer
 * pane, over the pool stand-in whose holders carry an xterm textarea.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubResizeObserver, installMatchMedia } from "../../../test-utils";
import type { GridSpeech } from "../../speech/types";
import type { TerminalHandle } from "../TerminalView";
import type { SessionMeta } from "../useTerminalSessions";
import {
  CELLS,
  cellsHost,
  eyeOf,
  paneOf,
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
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../useOsUsers", () => ({ useOsUsers: () => ({ users: [] }) }));
vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({ defaultUsers: {}, setDefaultUser: async () => {} }),
}));

const { TerminalsSurface } = await import("../TerminalsSurface");
const { useTerminalFullscreen } = await import("../useTerminalFullscreen");
const { useITermShortcuts } = await import("../../projects/useITermShortcuts");
const { useFullscreenLayerActive } = await import("../../shell/Layout/fullscreenLayer");
const { forgetAnswerPane, getAnswerPaneState } = await import("../answerPaneState");

const SESSIONS: SessionMeta[] = CELLS.map((id, i) => ({
  id,
  name: id,
  project: "vector",
  cwd: "/v",
  pid: i + 1,
  createdAt: `2026-11-14T00:00:0${i}Z`,
}));

/** A surface wired the way `ProjectTerminalsSurface` wires it. */
function Surface({ speech, startMaximized }: { speech: GridSpeech; startMaximized: boolean }) {
  const [sessions, setSessions] = useState(SESSIONS);
  const [minimisedIds, setMinimisedIds] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>("cell-a");
  const [maximized, setMaximized] = useState(startMaximized);
  const handles = useRef<Map<string, TerminalHandle>>(new Map());
  const fullscreen = useTerminalFullscreen();
  const chromeCovered = useFullscreenLayerActive();
  useITermShortcuts({
    active: true,
    sessions,
    focusedId,
    setFocusedId,
    projects: [],
    navTo: () => {},
    maximized,
    setMaximized,
  });
  return (
    <>
      <span data-testid="chrome-covered">{String(chromeCovered)}</span>
      <span data-testid="maximized">{String(maximized)}</span>
      <TerminalsSurface
        currentProject="vector"
        repos={[]}
        sessions={sessions}
        focusedId={focusedId}
        onFocus={setFocusedId}
        onDeleteSession={(id) => setSessions((cur) => cur.filter((x) => x.id !== id))}
        onUpdateSession={() => {}}
        allSessions={sessions}
        maximized={maximized}
        onToggleMaximize={() => setMaximized((m) => !m)}
        drawerOpen={false}
        onSetDrawerOpen={() => {}}
        terminalHandlesRef={handles}
        onCreateTerminal={() => {}}
        onNavTo={() => {}}
        tiles={[]}
        minimisedIds={minimisedIds}
        onMinimise={(id) => setMinimisedIds((cur) => [...cur, id])}
        onRestore={(id) => setMinimisedIds((cur) => cur.filter((x) => x !== id))}
        speech={speech}
        fullscreen={fullscreen}
      />
    </>
  );
}

async function renderSurface({ maximized = false } = {}) {
  const { speech } = cellsHost();
  const view = render(
    <MemoryRouter>
      <Surface speech={speech} startMaximized={maximized} />
    </MemoryRouter>,
  );
  await settleCells();
  return view;
}

const layer = (kind: "cell" | "terminal") =>
  document.querySelector<HTMLElement>(`[data-terminal-fullscreen="${kind}"]`);
const chromeCovered = () => screen.getByTestId("chrome-covered").textContent;
async function click(el: HTMLElement) {
  fireEvent.click(el);
  await settleCells();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
  for (const id of CELLS) forgetAnswerPane(id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalFullscreenLayer", () => {
  it("cell fullscreen shows the whole cell alone over the chrome", async () => {
    await renderSurface();
    fireEvent.click(eyeOf("cell-a"));
    expect(paneOf("cell-a")).not.toBeNull();
    expect(chromeCovered()).toBe("false");
    expect(layer("cell")).toBeNull();

    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));

    const host = layer("cell")!;
    expect(host).not.toBeNull();
    // A fixed full-viewport layer on the mockup tier, holding the chrome down.
    expect(host.className).toContain("fixed");
    expect(host.className).toContain("inset-0");
    expect(host.className).toContain("z-[90]");
    expect(chromeCovered()).toBe("true");
    // The whole cell: header, speech row, terminal and answer pane ...
    expect(host).toContainElement(screen.getByTestId("terminal-cell-kill-cell-a"));
    expect(host).toContainElement(eyeOf("cell-a"));
    expect(host).toContainElement(terminalOf("cell-a"));
    expect(host).toContainElement(paneOf("cell-a"));
    // ... alone: no other cell, no toolbar.
    expect(host).not.toContainElement(terminalOf("cell-b"));
    expect(host).not.toContainElement(screen.getByTestId("terminal-cell-kill-cell-b"));
    expect(host).not.toContainElement(screen.getByTestId("terminal-toolbar-reconnect"));
    // The pooled xterm is rendered once, inside the layer, not twice.
    expect(document.querySelectorAll('[data-holder="cell-a"]')).toHaveLength(1);
    expect(host).toContainElement(document.querySelector('[data-holder="cell-a"]') as HTMLElement);

    // Its exit control closes it.
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    expect(layer("cell")).toBeNull();
    expect(chromeCovered()).toBe("false");
  });

  it("terminal fullscreen shows tab strip and grid", async () => {
    await renderSurface();

    await click(screen.getByTestId("terminal-toolbar-fullscreen"));

    const host = layer("terminal")!;
    expect(host).not.toBeNull();
    expect(host.className).toContain("fixed");
    expect(host.className).toContain("z-[90]");
    expect(chromeCovered()).toBe("true");
    expect(host).toContainElement(screen.getByTestId("terminal-toolbar-reconnect"));
    expect(host).toContainElement(screen.getByTestId("terminal-grid"));
    for (const id of CELLS) expect(host).toContainElement(terminalOf(id));
    expect(document.querySelectorAll('[data-holder="cell-a"]')).toHaveLength(1);

    // The toolbar control, now the exit, closes it.
    await click(screen.getByTestId("terminal-toolbar-fullscreen"));
    expect(layer("terminal")).toBeNull();
    expect(chromeCovered()).toBe("false");
  });

  it("escape inside the layer reaches the terminal and keeps the layer open", async () => {
    // Cell layer over a tiled grid.
    const view = await renderSurface();
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    let reached = terminalKeys("cell-a");
    terminalOf("cell-a").focus();
    expect(fireEvent.keyDown(terminalOf("cell-a"), { key: "Escape" })).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1);
    await settleCells();
    expect(layer("cell")).not.toBeNull();

    // Terminal layer.
    await click(screen.getByTestId("terminal-toolbar-fullscreen"));
    expect(layer("terminal")).not.toBeNull();
    reached = terminalKeys("cell-b");
    terminalOf("cell-b").focus();
    expect(fireEvent.keyDown(terminalOf("cell-b"), { key: "Escape" })).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1);
    await settleCells();
    expect(layer("terminal")).not.toBeNull();
    view.unmount();

    // In Max, Escape is the iTerm shortcuts' "back to grid" — but it is still
    // not an exit from the layer, and the terminal still receives it.
    await renderSurface({ maximized: true });
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    reached = terminalKeys("cell-a");
    terminalOf("cell-a").focus();
    fireEvent.keyDown(terminalOf("cell-a"), { key: "Escape" });
    expect(reached).toHaveBeenCalledTimes(1);
    await settleCells();
    expect(layer("cell")).not.toBeNull();
    expect(layer("cell")).toContainElement(terminalOf("cell-a"));
  });

  it("answer pane state survives entering cell fullscreen", async () => {
    await renderSurface();
    // cell-a open; cell-b opened, then hidden by choice.
    fireEvent.click(eyeOf("cell-a"));
    fireEvent.click(eyeOf("cell-b"));
    fireEvent.click(eyeOf("cell-b"));
    expect(paneOf("cell-a")).not.toBeNull();
    expect(paneOf("cell-b")).toBeNull();
    expect(getAnswerPaneState("cell-b").hiddenByChoice).toBe(true);

    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    expect(layer("cell")).toContainElement(paneOf("cell-a"));
    expect(eyeOf("cell-a")).toHaveAttribute("aria-pressed", "true");
    expect(getAnswerPaneState("cell-a")).toEqual({ open: true, hiddenByChoice: false });

    // Straight to the other cell: still hidden by choice there.
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-b"));
    expect(layer("cell")).toContainElement(terminalOf("cell-b"));
    expect(paneOf("cell-b")).toBeNull();
    expect(eyeOf("cell-b")).toHaveAttribute("aria-pressed", "false");
    expect(getAnswerPaneState("cell-b")).toEqual({ open: false, hiddenByChoice: true });

    // And leaving the layer changes neither.
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-b"));
    await act(async () => {});
    expect(paneOf("cell-a")).not.toBeNull();
    expect(paneOf("cell-b")).toBeNull();
  });

  it("a cell that leaves the grid closes its layer and releases the chrome", async () => {
    await renderSurface();
    // Minimised from its own header, inside the layer.
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    expect(layer("cell")).toContainElement(terminalOf("cell-a"));
    expect(chromeCovered()).toBe("true");
    await click(screen.getByTestId("terminal-cell-minimise-cell-a"));
    expect(layer("cell")).toBeNull();
    expect(chromeCovered()).toBe("false");
    // The layer went with the cell, not just its host: restored, the cell is
    // back in the grid, not fullscreen again.
    await click(screen.getByTestId("minimised-tray-pill-cell-a"));
    expect(terminalOf("cell-a")).toBeInTheDocument();
    expect(layer("cell")).toBeNull();
    expect(chromeCovered()).toBe("false");

    // Killed, after the confirmation.
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-b"));
    expect(layer("cell")).toContainElement(terminalOf("cell-b"));
    await click(screen.getByTestId("terminal-cell-kill-cell-b"));
    await click(screen.getByTestId("confirm-close-terminal-confirm"));
    expect(screen.queryByLabelText("terminal input cell-b")).toBeNull();
    expect(layer("cell")).toBeNull();
    expect(chromeCovered()).toBe("false");
  });

  it("a cell layer in Max stays visible after focus moves to another cell", async () => {
    await renderSurface({ maximized: true });
    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    await click(screen.getByTestId("terminal-toolbar-chip-cell-b"));
    expect(screen.getByTestId("maximized").textContent).toBe("true");

    const host = layer("cell")!;
    expect(host).toContainElement(terminalOf("cell-a"));
    // Max now hides cell-a's wrapper ...
    expect(host.parentElement!.style.visibility).toBe("hidden");
    expect(host.parentElement!.style.pointerEvents).toBe("none");
    // ... and the layer does not inherit it.
    expect(host.style.visibility).toBe("visible");
    expect(host.style.pointerEvents).toBe("auto");
  });

  it("opening and closing a cell layer keeps the same host and cell nodes", async () => {
    await renderSurface();
    const cellNode = terminalOf("cell-a").closest("[data-terminal-cell]")!;
    const hostNode = cellNode.parentElement!;
    const holder = document.querySelector('[data-holder="cell-a"]');
    expect(hostNode.className).toBe("contents");

    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    expect(layer("cell")).toBe(hostNode);
    expect(hostNode.firstElementChild).toBe(cellNode);
    expect(document.querySelector('[data-holder="cell-a"]')).toBe(holder);

    await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
    expect(layer("cell")).toBeNull();
    expect(terminalOf("cell-a").closest("[data-terminal-cell]")).toBe(cellNode);
    expect(cellNode.parentElement).toBe(hostNode);
    expect(hostNode.className).toBe("contents");
    expect(document.querySelector('[data-holder="cell-a"]')).toBe(holder);
  });

  describe("keyboard focus stays inside an open layer", () => {
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusablesIn = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE));

    it("Tab from the last control wraps to the first, Shift+Tab from the first to the last", async () => {
      await renderSurface();
      fireEvent.click(eyeOf("cell-a"));
      await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
      const host = layer("cell")!;
      const items = focusablesIn(host);
      const first = items[0]!;
      const last = items[items.length - 1]!;
      expect(last.closest(".xterm")).toBeNull();

      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(first);

      expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(last);
    });

    it("Tab inside the xterm is left to the terminal", async () => {
      await renderSurface();
      await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
      const host = layer("cell")!;
      // With no pane open the terminal's textarea is the layer's last stop:
      // exactly where a trap would wrongly take the key.
      const items = focusablesIn(host);
      expect(items[items.length - 1]).toBe(terminalOf("cell-a"));
      const reached = terminalKeys("cell-a");
      terminalOf("cell-a").focus();

      expect(fireEvent.keyDown(terminalOf("cell-a"), { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(terminalOf("cell-a"), { key: "Tab", shiftKey: true })).toBe(true);
      expect(reached).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(terminalOf("cell-a"));
    });

    it("opening moves focus in, closing gives it back", async () => {
      await renderSurface();
      const outside = screen.getByTestId("terminal-toolbar-reconnect");
      outside.focus();
      expect(document.activeElement).toBe(outside);

      // A cell layer opened while focus is outside it: focus lands on its xterm.
      await click(screen.getByTestId("terminal-cell-fullscreen-cell-a"));
      expect(document.activeElement).toBe(terminalOf("cell-a"));

      // Closed from its own exit control: focus goes back where it was.
      const exit = screen.getByTestId("terminal-cell-fullscreen-cell-a");
      exit.focus();
      await click(exit);
      expect(layer("cell")).toBeNull();
      expect(document.activeElement).toBe(outside);
    });

    it("a terminal layer keeps focus that is already inside it", async () => {
      await renderSurface();
      terminalOf("cell-b").focus();
      await click(screen.getByTestId("terminal-toolbar-fullscreen"));
      expect(layer("terminal")).not.toBeNull();
      expect(document.activeElement).toBe(terminalOf("cell-b"));
    });
  });
});
