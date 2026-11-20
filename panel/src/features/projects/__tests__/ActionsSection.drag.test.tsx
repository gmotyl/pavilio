import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../useProjects", () => ({ useProjects: () => [] }));
vi.mock("../useLaunchRun", () => ({ useLaunchRun: () => async () => {} }));
vi.mock("../../alerts/store", () => ({ alerts: { error: vi.fn(), success: vi.fn() } }));

import { ActionsSection } from "../ActionsSection";
import { preferences, DEFAULT_HOME_ACTIONS } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  clearPreference,
  readPreference,
  writePreference,
} from "../../../preferences/store";

const A = (label: string) => ({ label, runner: "claude", text: `do-${label}`, project: "workspace" });
const SEED = [A("One"), A("Two"), A("Three")];

let under: Element | null = null;
let lastX = 0;
const card = (i: number) => screen.getByTestId(`action-card-${i}`);
const grip = (i: number) => within(card(i)).getByTestId("action-grip");
/** Cards are 100px wide at x=0: 10 = left half (before), 90 = right half (after). */
function startDrag(i: number) {
  fireEvent.pointerDown(grip(i), { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 0, clientY: 40, pointerId: 1 });
}
function hover(i: number, x: number) {
  under = card(i);
  lastX = x;
  fireEvent.pointerMove(window, { clientX: x, clientY: 40, pointerId: 1 });
}
const drop = () => fireEvent.pointerUp(window, { clientX: lastX, clientY: 40, pointerId: 1 });
const labels = () =>
  Array.from(screen.getByTestId("actions-grid").querySelectorAll("[data-testid^='action-card-']")).map(
    (c) => c.querySelector("button")?.getAttribute("aria-label"),
  );

describe("ActionsSection drag", () => {
  const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
  beforeEach(() => {
    __resetPreferenceStoreForTests();
    writePreference(preferences.homeActions, SEED);
    under = null;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 60, bottom: 60, left: 0, right: 100, width: 100, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => under });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (nativeMatchMedia) Object.defineProperty(window, "matchMedia", nativeMatchMedia);
    else delete (window as { matchMedia?: unknown }).matchMedia;
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("dropping a card reorders and persists", () => {
    render(<ActionsSection />);
    startDrag(2);
    hover(0, 10);
    drop();
    expect(labels()).toEqual(["Run Three", "Run One", "Run Two"]);
    expect(readPreference(preferences.homeActions).map((a) => a.label)).toEqual(["Three", "One", "Two"]);
  });

  it("writes the full list when home.actions was never stored", () => {
    clearPreference(preferences.homeActions);
    render(<ActionsSection />);
    startDrag(1);
    hover(0, 10);
    drop();
    expect(readPreference(preferences.homeActions).map((a) => a.label)).toEqual([
      DEFAULT_HOME_ACTIONS[1].label,
      DEFAULT_HOME_ACTIONS[0].label,
    ]);
  });

  it("dragged card is faded and the drop line shows", () => {
    render(<ActionsSection />);
    startDrag(2);
    hover(1, 10);
    expect(card(2).getAttribute("data-dragging")).toBe("true");
    expect(card(2).style.opacity).toBe("0.45");
    expect(card(1).getAttribute("data-drop")).toBe("before");
    expect(card(1).style.boxShadow).toContain("inset 0 2px 0");
    hover(1, 90);
    expect(card(1).getAttribute("data-drop")).toBe("after");
    expect(card(1).style.boxShadow).toContain("inset 0 -2px 0");
  });

  it("+ New action stays last and is not draggable", () => {
    render(<ActionsSection />);
    const add = screen.getByRole("button", { name: "+ New action" });
    expect(add.hasAttribute("data-card-key")).toBe(false);
    fireEvent.pointerDown(add, { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40, pointerId: 1 });
    expect(card(0).hasAttribute("data-dragging")).toBe(false);
    // Dropping a card on it is no target: nothing moves.
    startDrag(0);
    under = add;
    lastX = 90;
    fireEvent.pointerMove(window, { clientX: 90, clientY: 40, pointerId: 1 });
    drop();
    expect(readPreference(preferences.homeActions).map((a) => a.label)).toEqual(["One", "Two", "Three"]);
    const grid = screen.getByTestId("actions-grid");
    expect(grid.lastElementChild).toBe(add);
  });

  it("no drag on mobile", () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    render(<ActionsSection />);
    expect(screen.queryByTestId("action-grip")).toBeNull();
    fireEvent.pointerDown(card(2), { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40, pointerId: 1 });
    hover(0, 10);
    drop();
    expect(card(2).hasAttribute("data-dragging")).toBe(false);
    expect(readPreference(preferences.homeActions).map((a) => a.label)).toEqual(["One", "Two", "Three"]);
  });
});
