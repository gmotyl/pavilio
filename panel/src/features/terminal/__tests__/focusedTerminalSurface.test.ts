/**
 * The module store behind the fullscreen shortcuts: which registered terminal
 * surface a keypress targets, and each surface's focused cell.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  focusedCellOf,
  setSurfaceLayerOpen,
  setSurfaceRoot,
  shortcutTarget,
  unregisterTerminalSurface,
} from "../focusedTerminalSurface";

const ids: string[] = [];

/** A surface root with one cell (header button + xterm textarea) and a toolbar button. */
function surface(id: string, cellId: string) {
  const root = document.createElement("div");
  root.innerHTML = `
    <button data-testid="${id}-toolbar">tb</button>
    <div data-terminal-cell="${cellId}">
      <div data-terminal-cell-header=""><button data-testid="${id}-header">h</button></div>
      <div class="xterm"><textarea data-testid="${id}-xterm"></textarea></div>
      <button data-testid="${id}-pane">pane</button>
    </div>`;
  document.body.appendChild(root);
  setSurfaceRoot(id, root);
  ids.push(id);
  const q = (s: string) => root.querySelector<HTMLElement>(`[data-testid="${id}-${s}"]`)!;
  return { root, toolbar: q("toolbar"), header: q("header"), xterm: q("xterm"), pane: q("pane") };
}

const press = () => new KeyboardEvent("keydown", { code: "KeyT", altKey: true, shiftKey: true });

afterEach(() => {
  for (const id of ids.splice(0)) unregisterTerminalSurface(id);
  document.body.innerHTML = "";
});

describe("focusedTerminalSurface", () => {
  it("records the cell whose xterm or header took focus, not other controls", () => {
    const s = surface("s1", "c1");
    expect(focusedCellOf("s1")).toBeNull();
    s.pane.focus();
    s.toolbar.focus();
    expect(focusedCellOf("s1")).toBeNull();
    s.header.focus();
    expect(focusedCellOf("s1")).toBe("c1");
    unregisterTerminalSurface("s1");
    const t = surface("s1", "c2");
    t.xterm.focus();
    expect(focusedCellOf("s1")).toBe("c2");
  });

  it("the surface holding focus wins, else the most recently focused", () => {
    const a = surface("a", "ca");
    const b = surface("b", "cb");
    a.xterm.focus();
    expect(shortcutTarget(press())).toBe("a");
    b.toolbar.focus();
    expect(shortcutTarget(press())).toBe("b");
    b.toolbar.blur();
    expect(document.activeElement).toBe(document.body);
    expect(shortcutTarget(press())).toBe("b");
    a.toolbar.focus();
    a.toolbar.blur();
    expect(shortcutTarget(press())).toBe("a");
  });

  it("a surface with an open layer wins over focus", () => {
    surface("a", "ca");
    const b = surface("b", "cb");
    setSurfaceLayerOpen("a", true);
    b.xterm.focus();
    expect(shortcutTarget(press())).toBe("a");
    setSurfaceLayerOpen("a", false);
    expect(shortcutTarget(press())).toBe("b");
  });

  it("resolves one target per event, however the state moves while it is handled", () => {
    const a = surface("a", "ca");
    surface("b", "cb");
    a.xterm.focus();
    const e = press();
    expect(shortcutTarget(e)).toBe("a");
    // The first handler opens a's layer and focus moves: the same event keeps
    // its target, so a second listener cannot act on it too.
    setSurfaceLayerOpen("b", true);
    expect(shortcutTarget(e)).toBe("a");
    expect(shortcutTarget(press())).toBe("b");
  });

  it("an unregistered surface is never a target", () => {
    const a = surface("a", "ca");
    a.xterm.focus();
    unregisterTerminalSurface("a");
    expect(shortcutTarget(press())).toBeNull();
    expect(focusedCellOf("a")).toBeNull();
  });
});
