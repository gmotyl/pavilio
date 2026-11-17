import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useSidebarDrag } from "../useSidebarDrag";
import type { SidebarOrder } from "../sidebarOrder";
import * as alertStore from "../../alerts/store";

/**
 * Pointer-event drag in the sidebar Projects tree. Mockup:
 * projects/pavilio/mockups/2026-11-17-project-groups-sidebar-and-menus.html
 * (check 5 — line = position, dashed outline = into group, as data-drop).
 */

type P = { name: string; group: string | null };

const PROJECTS: P[] = [
  { name: "omnivoice-server", group: "Motyl OSS" },
  { name: "zdrofit-sniper", group: "Motyl OSS" },
  { name: "infopoly", group: "InfoPoly" },
  { name: "anytts", group: null },
  { name: "pavilio", group: null },
];
const ORDER: SidebarOrder = {
  top: ["g:Motyl OSS", "g:InfoPoly", "p:anytts", "p:pavilio"],
  groups: { "Motyl OSS": ["omnivoice-server", "zdrofit-sniper"] },
};

function Harness({
  isMobile = false,
  onOrder,
  projects = PROJECTS,
}: {
  isMobile?: boolean;
  onOrder: (o: SidebarOrder) => void;
  projects?: P[];
}) {
  const [order, setOrder] = useState(ORDER);
  const drag = useSidebarDrag({
    projects,
    order,
    setOrder: (o) => {
      setOrder(o);
      onOrder(o);
    },
    isMobile,
  });
  return (
    <ul>
      {drag.tree.map((n) =>
        n.kind === "project" ? (
          <li key={n.name}>
            <div data-testid={`row-${n.name}`} {...drag.rowProps(`p:${n.name}`, null)} />
          </li>
        ) : (
          <li key={n.name}>
            <div data-testid={`row-g-${n.name}`} {...drag.rowProps(`g:${n.name}`, null)} />
            <ul data-testid={`members-${n.name}`}>
              {n.members.map((m) => (
                <li key={m}>
                  <div data-testid={`row-${m}`} {...drag.rowProps(`p:${m}`, n.name)} />
                </li>
              ))}
            </ul>
          </li>
        ),
      )}
    </ul>
  );
}

/** Rows are 20px tall at y=0: 2 = top edge, 10 = middle, 18 = bottom edge. */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function startDrag(id: string) {
  const el = screen.getByTestId(id);
  fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 0, clientY: 30, pointerId: 1 });
}
function hover(id: string, y: number) {
  fireEvent.pointerMove(screen.getByTestId(id), { clientX: 0, clientY: y, pointerId: 1 });
}
function drop() {
  fireEvent.pointerUp(window, { pointerId: 1 });
}

describe("useSidebarDrag", () => {
  it("drag shows a drop line and into-group outline", () => {
    render(<Harness onOrder={() => {}} />);
    startDrag("row-anytts");
    hover("row-pavilio", 2);
    expect(screen.getByTestId("row-pavilio").getAttribute("data-drop")).toBe("before");
    hover("row-g-InfoPoly", 10);
    expect(screen.getByTestId("row-g-InfoPoly").getAttribute("data-drop")).toBe("into");
    expect(screen.getByTestId("row-pavilio").hasAttribute("data-drop")).toBe(false);
    expect(screen.getByTestId("row-anytts").getAttribute("draggable")).toBeNull();
  });

  it("reorder within a group updates order only", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-zdrofit-sniper");
    hover("row-omnivoice-server", 2);
    drop();
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onOrder.mock.calls[0][0].groups["Motyl OSS"]).toEqual([
      "zdrofit-sniper",
      "omnivoice-server",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("top-level reorder updates top order", () => {
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-g-InfoPoly");
    hover("row-pavilio", 18);
    drop();
    expect(onOrder.mock.calls[0][0].top).toEqual([
      "g:Motyl OSS",
      "p:anytts",
      "p:pavilio",
      "g:InfoPoly",
    ]);
  });

  it("drop onto another group sends group put", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ group: "InfoPoly" })));
    vi.stubGlobal("fetch", fetchMock);
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-anytts");
    hover("row-g-InfoPoly", 10);
    await act(async () => drop());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/anytts/group",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ group: "InfoPoly" }) }),
    );
    // optimistic placement inside the group
    expect(screen.getByTestId("members-InfoPoly").contains(screen.getByTestId("row-anytts"))).toBe(true);
    const last = onOrder.mock.calls.at(-1)![0];
    expect(last.groups.InfoPoly).toEqual(["infopoly", "anytts"]);
    expect(last.top).not.toContain("p:anytts");
  });

  it("drop to top level clears group", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ group: null })));
    vi.stubGlobal("fetch", fetchMock);
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-zdrofit-sniper");
    hover("row-pavilio", 2);
    await act(async () => drop());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/zdrofit-sniper/group",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ group: null }) }),
    );
    expect(onOrder.mock.calls.at(-1)![0].top).toEqual([
      "g:Motyl OSS",
      "g:InfoPoly",
      "p:anytts",
      "p:zdrofit-sniper",
      "p:pavilio",
    ]);
  });

  it("failed put reverts and alerts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("git error", { status: 500 })));
    const errorSpy = vi.spyOn(alertStore.alerts, "error");
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-anytts");
    hover("row-g-InfoPoly", 10);
    await act(async () => drop());
    expect(onOrder).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(screen.getByTestId("members-InfoPoly").contains(screen.getByTestId("row-anytts"))).toBe(false);
  });

  it("no drag on mobile", () => {
    const onOrder = vi.fn();
    render(<Harness isMobile onOrder={onOrder} />);
    startDrag("row-anytts");
    hover("row-pavilio", 2);
    expect(screen.getByTestId("row-pavilio").hasAttribute("data-drop")).toBe(false);
    drop();
    expect(onOrder).not.toHaveBeenCalled();
  });
});
