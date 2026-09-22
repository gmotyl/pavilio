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
 * suite green while sliding `<h2>Projects</h2>` under the button: dropping both
 * `leading={<HamburgerSlot />}` props, zeroing `.sidebar-hamburger-slot`'s
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
  useGitStatus: () => ({ files: [], suggestion: "", refetch: () => {} }),
}));
vi.mock("../../speech/useSpeechHost", async () => {
  const { INERT_SPEECH_HOST } = await import(
    "../../terminal/__tests__/speech.harness"
  );
  return { useSpeechHost: () => INERT_SPEECH_HOST, default: () => INERT_SPEECH_HOST };
});

import LeftSidebar from "../LeftSidebar";
import SidebarHamburger from "../SidebarHamburger";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

function setup(starred: string[] = []) {
  favorites.starred = new Set(starred);
  return render(
    <MemoryRouter initialEntries={["/project/vector/memo"]}>
      <SidebarHamburger expanded onToggle={() => {}} />
      <SpeechHostProvider>
        <LeftSidebar />
      </SpeechHostProvider>
    </MemoryRouter>,
  );
}

/** Every section heading the sidebar renders, in document order. */
const headings = () => Array.from(document.querySelectorAll("h2"));

/** The reserved boxes — there must be exactly one, in exactly one row. */
const slots = () =>
  Array.from(document.querySelectorAll(".sidebar-hamburger-slot"));

describe("the hamburger's reserved slot", () => {
  beforeEach(() => localStorage.clear());

  it("is the leading item of the FIRST header row on screen", () => {
    // No stars: Projects is the row at the top, so the slot is Projects'.
    const plain = setup();
    expect(headings().map((h) => h.textContent)).toEqual([
      "Projects",
      "Git",
    ]);
    expect(slots()).toHaveLength(1);
    expect(slots()[0].parentElement).toBe(headings()[0].parentElement);
    expect(slots()[0].parentElement?.firstElementChild).toBe(slots()[0]);
    plain.unmount();

    // A starred project pushes a Starred section above it, and the slot has to
    // move with the row rather than stay with the section it started on.
    setup(["vector"]);
    expect(headings().map((h) => h.textContent)).toEqual([
      "Starred",
      "Projects",
      "Git",
    ]);
    expect(slots()).toHaveLength(1);
    expect(slots()[0].parentElement).toBe(headings()[0].parentElement);
    expect(slots()[0].parentElement?.firstElementChild).toBe(slots()[0]);
  });

  it("is the button's own box, at the button's own origin", () => {
    setup();
    const row = headings()[0].parentElement!;
    const column = row.closest(".overflow-auto")!;

    // Same size. A slot narrower than the button (0px, say) reserves a corner
    // the button does not fit in, and the heading slides under it.
    expect(SLOT.width).toBe(HAMBURGER.width);
    expect(SLOT.height).toBe(HAMBURGER.height);

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
    setup();
    const heading = headings()[0];
    const row = heading.parentElement!;

    // 12 (`p-3`) + 4 (`px-1`) + 24 (slot) + 8 (`gap-2`) + 12 (icon) + 8 (gap).
    // Derived rather than written down, so the arithmetic tracks the row: drop
    // the slot and it answers 36, zero the slot's width and it answers 44 —
    // both of them under the button's 40px right edge, or on top of it.
    expect(flexGap(row)).toBe(8);
    expect(headingOriginX(heading)).toBe(68);
    expect(headingOriginX(heading)).toBeGreaterThanOrEqual(
      HAMBURGER.left + HAMBURGER.width,
    );

    // And with a Starred row above, the same clearance on that row instead.
    const starred = setup(["vector"]);
    expect(headingOriginX(headings()[0])).toBe(68);
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
