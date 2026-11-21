import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  cssRule,
  HAMBURGER,
  SLOT,
  flexGap,
  headingOriginX,
  leftPadding,
} from "./hamburgerGeometry";

/**
 * AC4, made executable: "the hamburger sits in the sidebar's header row".
 *
 * The AC is a claim about two boxes lining up — one fixed to the viewport by
 * the stylesheet, one laid out in flow by `LeftSidebar` — and it shipped with
 * nothing asserting either half. Four independent edits used to leave the whole
 * suite green while sliding `<h2>Projects</h2>` under the button: dropping the
 * `HamburgerSlot` from the first (Home) row, zeroing `.sidebar-hamburger-slot`'s
 * width, dropping `className="sidebar-hamburger"` (which un-positions the
 * control entirely), and moving `left: 16px` to somewhere else.
 *
 * jsdom does no layout, so none of that can be caught by measuring. It is
 * caught by re-deriving the heading's origin from the DOM the components
 * actually produce and the constants the stylesheet actually holds, and
 * checking the number that falls out.
 */

const favorites = vi.hoisted(() => ({ starred: new Set<string>() }));

vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [
    { name: "vector", repos: [] },
    { name: "atlas", repos: [] },
  ],
}));
vi.mock("../../projects/useArchivedProjects", () => ({
  useArchivedProjects: () => ({ archive: [], archivedNames: new Set() }),
}));
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: (name: string) => favorites.starred.has(name),
    toggleFavorite: () => {},
    favorites: [...favorites.starred],
  }),
}));
vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({ sessions: [], refresh: () => {} }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () => ({
  useMobileAccessStatus: () => ({ enabled: false }),
}));
vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: null }),
}));
vi.mock("../../git/useGitStatus", () => ({
  useGitStatus: () => ({ files: [], refetch: () => {} }),
}));
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  return { useSpeechHost: () => INERT_SPEECH_HOST, default: () => INERT_SPEECH_HOST };
});

import LeftSidebar from "../LeftSidebar";
import SidebarHamburger from "../SidebarHamburger";
import { TerminalSpeechHost } from "../../terminal/TerminalSpeechHost";

function setup(starred: string[] = []) {
  favorites.starred = new Set(starred);
  return render(
    <MemoryRouter initialEntries={["/project/vector/memo"]}>
      <SidebarHamburger expanded onToggle={() => {}} />
      <TerminalSpeechHost>
        <LeftSidebar />
      </TerminalSpeechHost>
    </MemoryRouter>,
  );
}

/** Every section heading the sidebar renders, in document order. */
const headings = () => Array.from(document.querySelectorAll("h2"));

/** The reserved boxes — there must be exactly one, in exactly one row. */
const firstRow = () => screen.getByTestId("sidebar-first-row");
const homeLink = () => screen.getByTestId("sidebar-home-link");

const slots = () =>
  Array.from(document.querySelectorAll(".sidebar-hamburger-slot"));

describe("the hamburger's reserved slot", () => {
  beforeEach(() => localStorage.clear());

  it("is the leading item of the FIRST row on screen, the Home row", () => {
    // The first row is now always the Home row, with or without stars; the
    // section headings below it carry no slot of their own.
    const plain = setup();
    expect(headings().map((h) => h.textContent)).toEqual([
      "Projects",
      "Research",
      "Git",
    ]);
    expect(slots()).toHaveLength(1);
    expect(slots()[0].parentElement).toBe(firstRow());
    expect(firstRow().firstElementChild).toBe(slots()[0]);
    expect(firstRow().parentElement?.firstElementChild).toBe(firstRow());
    plain.unmount();

    // A Starred section appears below the Home row; the slot stays put.
    setup(["vector"]);
    expect(headings().map((h) => h.textContent)).toEqual([
      "Starred",
      "Projects",
      "Research",
      "Git",
    ]);
    expect(slots()).toHaveLength(1);
    expect(slots()[0].parentElement).toBe(firstRow());
    expect(firstRow().firstElementChild).toBe(slots()[0]);
  });

  it("is the button's own box, at the button's own origin", () => {
    setup();
    const row = firstRow();
    const column = row.closest(".overflow-auto")!;

    // Same size. A slot narrower than the button (0px, say) reserves a corner
    // the button does not fit in, and the heading slides under it.
    expect(SLOT.width).toBe(HAMBURGER.width);
    expect(SLOT.height).toBe(HAMBURGER.height);

    // A width is only half of a reservation, and the other half is why two
    // more edits used to survive this whole file: `display: none` takes the
    // box out of the row entirely, and without `flex: none` the row is free to
    // shrink it toward zero. Neither touches a declared width, so the
    // arithmetic below goes on answering 68 while the heading has in fact slid
    // under the button. Read as declared — the same fidelity as the numbers
    // above, which is all a stylesheet nobody loads can be read at.
    const slotRule = cssRule(".sidebar-hamburger-slot");
    expect(slotRule).toMatch(/display:\s*block/);
    expect(slotRule).toMatch(/flex:\s*none/);

    // Same origin. The row's leading edge is the scrolling column's `p-3` plus
    // the row's own `px-1`, and the stylesheet's `left`/`top` have to be that
    // and nothing else — a button moved anywhere else is a button no longer in
    // the row that reserved space for it.
    expect(leftPadding(column)).toBe(12);
    expect(leftPadding(row)).toBe(4);
    expect(HAMBURGER.left).toBe(leftPadding(column) + leftPadding(row));
    expect(HAMBURGER.top).toBe(leftPadding(column));
  });

  it("leaves the heading clear of the button", () => {
    const plain = setup();
    const home = homeLink();
    const row = firstRow();

    // 12 (`p-3`) + 4 (`px-1`) + 24 (slot) + 8 (`gap-2`): the Home link starts
    // just right of the button's 40px edge. Derived rather than written down,
    // so the arithmetic tracks the row: drop the slot and it answers 24, zero
    // the slot's width and it answers 24 as well — both under the button.
    expect(flexGap(row)).toBe(8);
    expect(headingOriginX(home)).toBe(48);
    expect(headingOriginX(home)).toBeGreaterThanOrEqual(
      HAMBURGER.left + HAMBURGER.width,
    );

    // Starred rows below change nothing about it.
    plain.unmount();
    const starred = setup(["vector"]);
    expect(headingOriginX(homeLink())).toBe(48);
    starred.unmount();
  });

  it("is lined up with a button the stylesheet actually positions", () => {
    setup();
    const button = screen.getByTestId("sidebar-hamburger");

    // The class is the whole of the button's geometry — it carries no inline
    // style at all — so losing it does not nudge the control, it un-positions
    // it, and every constant asserted above stops describing anything.
    expect([...button.classList]).toContain("sidebar-hamburger");
    expect(button.getAttribute("style")).toBeNull();
    const rule = cssRule(".sidebar-hamburger");
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/left:\s*16px/);
    expect(rule).toMatch(/top:\s*12px/);
  });
});
