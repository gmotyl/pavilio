/**
 * Alt+Shift+T / Alt+Shift+C on real `TerminalsSurface`s with real cells (each
 * `TerminalView` over the pool stand-in, whose holders carry an xterm
 * textarea): which surface a press acts on, and which of its cells.
 *
 * Two surfaces stand in for the drawer and the project tab, both on screen,
 * each with its own `useTerminalFullscreen` the way their hosts wire it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubResizeObserver, installMatchMedia } from "../../../test-utils";
import type { GridSpeech } from "../../speech/types";
import type { TerminalHandle } from "../TerminalView";
import type { SessionMeta } from "../useTerminalSessions";
import { cellsHost, settleCells } from "./answerPaneCells.harness";

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

const meta = (id: string, i: number): SessionMeta => ({
  id,
  name: id,
  project: "vector",
  cwd: "/v",
  pid: i + 1,
  createdAt: `2026-11-14T00:00:0${i}Z`,
});

/** One surface, wired the way `ProjectTerminalsSurface` wires it. No cell is focused at mount. */
function Surface({ name, ids, speech }: { name: string; ids: string[]; speech: GridSpeech }) {
  const sessions = ids.map(meta);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const handles = useRef<Map<string, TerminalHandle>>(new Map());
  const fullscreen = useTerminalFullscreen();
  return (
    <div data-testid={`surface-${name}`}>
      <TerminalsSurface
        currentProject="vector"
        repos={[]}
        sessions={sessions}
        focusedId={focusedId}
        onFocus={setFocusedId}
        onDeleteSession={() => {}}
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
        speech={speech}
        fullscreen={fullscreen}
      />
    </div>
  );
}

/** The project tab (cells a, b) and the drawer (cells c, d), both on screen. */
async function renderTwo() {
  const { speech } = cellsHost();
  render(
    <MemoryRouter>
      <Surface name="tab" ids={["cell-a", "cell-b"]} speech={speech} />
      <Surface name="drawer" ids={["cell-c", "cell-d"]} speech={speech} />
    </MemoryRouter>,
  );
  await settleCells();
}

/** The project tab alone; `drawer(true)` mounts the drawer next to it, `drawer(false)` drops it. */
async function renderTabWithDrawerToggle() {
  const { speech } = cellsHost();
  const tree = (withDrawer: boolean) => (
    <MemoryRouter>
      <Surface name="tab" ids={["cell-a", "cell-b"]} speech={speech} />
      {withDrawer && <Surface name="drawer" ids={["cell-c", "cell-d"]} speech={speech} />}
    </MemoryRouter>
  );
  const { rerender } = render(tree(false));
  await settleCells();
  return async (withDrawer: boolean) => {
    rerender(tree(withDrawer));
    await settleCells();
  };
}

const xterm = (id: string) => screen.getByLabelText(`terminal input ${id}`);
const toolbarButton = (surface: "tab" | "drawer") =>
  screen
    .getByTestId(`surface-${surface}`)
    .querySelector<HTMLElement>('[data-testid="terminal-toolbar-maximize"]')!;
const cellHeader = (id: string) =>
  document.querySelector<HTMLElement>(`[data-terminal-cell="${id}"] [data-terminal-cell-header]`)!;
const layers = () => Array.from(document.querySelectorAll<HTMLElement>("[data-terminal-fullscreen]"));
const layer = (kind: "cell" | "terminal") =>
  document.querySelector<HTMLElement>(`[data-terminal-fullscreen="${kind}"]`);

/** Alt+Shift+<code> on `target`; true when nothing cancelled it. */
async function press(code: "KeyT" | "KeyC", target: Element = document.activeElement ?? document.body) {
  const passed = fireEvent.keyDown(target, { code, key: "ˇ", altKey: true, shiftKey: true });
  await settleCells();
  return passed;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fullscreen shortcuts", () => {
  it("Alt+Shift+T toggles the focused surface's terminal layer from xterm", async () => {
    await renderTwo();
    const reached = vi.fn();
    xterm("cell-c").addEventListener("keydown", reached);
    xterm("cell-c").focus();

    // Swallowed before xterm, and acted on by the drawer alone.
    expect(await press("KeyT", xterm("cell-c"))).toBe(false);
    expect(reached).not.toHaveBeenCalled();
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-c"));
    expect(layer("terminal")).toContainElement(xterm("cell-d"));
    expect(layer("terminal")).not.toContainElement(xterm("cell-a"));

    // Again from the same xterm: closed.
    expect(await press("KeyT", xterm("cell-c"))).toBe(false);
    expect(reached).not.toHaveBeenCalled();
    expect(layers()).toHaveLength(0);
  });

  it("Alt+Shift+C uses the last focused cell after focus moves to the toolbar", async () => {
    await renderTwo();
    xterm("cell-a").focus();
    xterm("cell-b").focus();
    toolbarButton("tab").focus();
    expect(document.activeElement).toBe(toolbarButton("tab"));

    await press("KeyC", toolbarButton("tab"));

    expect(layers()).toHaveLength(1);
    expect(layer("cell")).toContainElement(xterm("cell-b"));
    expect(layer("cell")).not.toContainElement(xterm("cell-a"));
  });

  it("Alt+Shift+C without a focused cell is a no-op", async () => {
    await renderTwo();
    // The drawer's cell took focus once; the tab's cells never did.
    xterm("cell-c").focus();
    toolbarButton("tab").focus();

    // Swallowed (it is a panel binding), but nothing opens on either surface.
    expect(await press("KeyC", toolbarButton("tab"))).toBe(false);
    expect(layers()).toHaveLength(0);

    // The tab is still the target: its terminal layer is what Alt+Shift+T opens.
    await press("KeyT", toolbarButton("tab"));
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
    expect(layer("terminal")).not.toContainElement(xterm("cell-c"));
  });

  it("the open layer's shortcut closes it", async () => {
    await renderTwo();
    // A cell layer on the tab, then focus moves to the drawer's terminal.
    xterm("cell-a").focus();
    await press("KeyC");
    expect(layer("cell")).toContainElement(xterm("cell-a"));
    xterm("cell-d").focus();

    await press("KeyC", xterm("cell-d"));
    expect(layers()).toHaveLength(0);

    // A terminal layer on the drawer, then focus leaves every surface.
    xterm("cell-d").focus();
    await press("KeyT");
    expect(layer("terminal")).toContainElement(xterm("cell-d"));
    (document.activeElement as HTMLElement).blur();
    xterm("cell-a").focus();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    await press("KeyT", document.body);
    expect(layers()).toHaveLength(0);
  });

  it("targets the most recently focused surface when two are visible", async () => {
    await renderTwo();
    xterm("cell-a").focus();
    xterm("cell-c").focus();
    (document.activeElement as HTMLElement).blur();

    // Nobody holds focus: the drawer was the last to.
    await press("KeyT", document.body);
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-c"));
    await press("KeyT", document.body);
    expect(layers()).toHaveLength(0);

    // The tab takes focus back (its toolbar): it is the target now.
    toolbarButton("tab").focus();
    await press("KeyT");
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
    await press("KeyT");

    // Alt+Shift+C follows the same pick, with that surface's own focused cell.
    xterm("cell-d").focus();
    await press("KeyC");
    expect(layers()).toHaveLength(1);
    expect(layer("cell")).toContainElement(xterm("cell-d"));
  });

  it("a surface mounted without taking focus does not beat the one that last held it", async () => {
    const drawer = await renderTabWithDrawerToggle();
    xterm("cell-a").focus();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    // The drawer opens (Cmd+B does not focus it): the tab is still the target.
    await drawer(true);
    await press("KeyT", document.body);
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
    expect(layer("terminal")).not.toContainElement(xterm("cell-c"));
  });

  it("the surface holding focus beats a surface mounted after it", async () => {
    const drawer = await renderTabWithDrawerToggle();
    xterm("cell-a").focus();
    await drawer(true);
    // A pointer-down on the drawer's header that moves no focus (Safari)
    // makes the drawer the latest used, but the tab still holds focus.
    fireEvent.pointerDown(cellHeader("cell-c"));
    expect(document.activeElement).toBe(xterm("cell-a"));

    await press("KeyT");
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
    expect(layer("terminal")).not.toContainElement(xterm("cell-c"));
  });

  it("a pointer-down on a cell header makes it the focused cell without a focus change", async () => {
    await renderTwo();
    xterm("cell-a").focus();
    fireEvent.pointerDown(cellHeader("cell-b"));
    expect(document.activeElement).toBe(xterm("cell-a"));

    await press("KeyC");
    expect(layers()).toHaveLength(1);
    expect(layer("cell")).toContainElement(xterm("cell-b"));
    expect(layer("cell")).not.toContainElement(xterm("cell-a"));
  });

  it("after the focused drawer unmounts, Alt+Shift+T acts on the tab", async () => {
    const drawer = await renderTabWithDrawerToggle();
    await drawer(true);
    xterm("cell-a").focus();
    xterm("cell-c").focus();

    await drawer(false);
    expect(screen.queryByTestId("surface-drawer")).toBeNull();
    await press("KeyT", document.body);
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
  });

  it("Alt+Shift+T over an open cell layer switches to the terminal layer", async () => {
    await renderTwo();
    xterm("cell-a").focus();
    await press("KeyC");
    expect(layer("cell")).toContainElement(xterm("cell-a"));

    await press("KeyT");
    expect(layers()).toHaveLength(1);
    expect(layer("terminal")).toContainElement(xterm("cell-a"));
    expect(layer("terminal")).toContainElement(xterm("cell-b"));
  });

  it("Alt+Shift+C over an open terminal layer switches to the focused cell's layer", async () => {
    await renderTwo();
    xterm("cell-b").focus();
    await press("KeyT");
    expect(layer("terminal")).toContainElement(xterm("cell-b"));

    await press("KeyC");
    expect(layers()).toHaveLength(1);
    expect(layer("cell")).toContainElement(xterm("cell-b"));
    expect(layer("cell")).not.toContainElement(xterm("cell-a"));
  });
});
