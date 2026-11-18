import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { applyDrop, dropStyle, useSidebarDrag } from "../useSidebarDrag";
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
  under = null;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => under,
  });
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
/** Where the pointer is: the tree resolves its target from elementFromPoint. */
let under: Element | null = null;
let lastY = 0;
function hover(id: string, y: number) {
  under = screen.getByTestId(id);
  lastY = y;
  fireEvent.pointerMove(window, { clientX: 0, clientY: y, pointerId: 1 });
}
function leave() {
  under = document.body;
  fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerId: 1 });
}
function drop() {
  fireEvent.pointerUp(window, { clientX: 0, clientY: lastY, pointerId: 1 });
}

/** Spy on Element.prototype.setPointerCapture (absent in jsdom), restorable. */
function spyCapture() {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(proto, "setPointerCapture");
  const original = proto.setPointerCapture;
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { restore: () => void };
  proto.setPointerCapture = fn;
  fn.restore = () => {
    if (had) proto.setPointerCapture = original;
    else delete proto.setPointerCapture;
  };
  return fn;
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
    // optimistic placement is covered by the refresh-ordering test below
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

  it("dragging by the project link blocks native link drag and captures the pointer", () => {
    function LinkHarness() {
      const drag = useSidebarDrag({ projects: PROJECTS, order: ORDER, setOrder: () => {}, isMobile: false });
      return (
        <div data-testid="row-x" {...drag.rowProps("p:anytts", null)}>
          <a href="/p/anytts" data-testid="link">anytts</a>
        </div>
      );
    }
    render(<LinkHarness />);
    const row = screen.getByTestId("row-x");
    const capture = vi.fn();
    (row as unknown as { setPointerCapture: unknown }).setPointerCapture = capture;
    fireEvent.pointerDown(screen.getByTestId("link"), { button: 0, clientX: 0, clientY: 10, pointerId: 7 });
    expect(capture).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 0, clientY: 30, pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerCancel(window, { pointerId: 7 });
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    screen.getByTestId("link").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("pointercancel clears the drag without committing", () => {
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-zdrofit-sniper");
    hover("row-omnivoice-server", 2);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(onOrder).not.toHaveBeenCalled();
    expect(screen.getByTestId("row-omnivoice-server").hasAttribute("data-drop")).toBe(false);
    expect(screen.getByTestId("row-zdrofit-sniper").hasAttribute("data-dragging")).toBe(false);
  });

  it("release outside the tree is a no-op", () => {
    const onOrder = vi.fn();
    render(<Harness onOrder={onOrder} />);
    startDrag("row-zdrofit-sniper");
    hover("row-omnivoice-server", 2);
    leave();
    expect(screen.getByTestId("row-omnivoice-server").hasAttribute("data-drop")).toBe(false);
    drop();
    expect(onOrder).not.toHaveBeenCalled();
  });

  it("saves the order only after the projects refresh resolves, then clears pending", async () => {
    let resolveList!: (r: Response) => void;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/projects") return new Promise<Response>((r) => (resolveList = r));
      return new Response(JSON.stringify({ group: "InfoPoly" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const listener = (e: Event) => {
      (e as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>).detail.waitUntil(
        fetch("/api/projects"),
      );
    };
    window.addEventListener("pavilio:projects-refresh", listener);
    const onOrder = vi.fn();
    try {
      render(<Harness onOrder={onOrder} />);
      startDrag("row-anytts");
      hover("row-g-InfoPoly", 10);
      await act(async () => drop());
      expect(onOrder).not.toHaveBeenCalled();
      // optimistic while refresh is in flight
      expect(screen.getByTestId("members-InfoPoly").contains(screen.getByTestId("row-anytts"))).toBe(true);
      await act(async () => resolveList(new Response("[]")));
      expect(onOrder).toHaveBeenCalledTimes(1);
      // discovery never reported the group (projects prop unchanged) → pending cleared, not stuck
      expect(screen.getByTestId("members-InfoPoly").contains(screen.getByTestId("row-anytts"))).toBe(false);
    } finally {
      window.removeEventListener("pavilio:projects-refresh", listener);
    }
  });

  it("unmount mid-drag clears timers and sets no state", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error");
    try {
      const { unmount } = render(<Harness onOrder={() => {}} />);
      startDrag("row-zdrofit-sniper");
      hover("row-omnivoice-server", 2);
      drop();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(err).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dragged row is dimmed with a grabbing cursor", () => {
    render(<Harness onOrder={() => {}} />);
    startDrag("row-anytts");
    expect(dropStyle(undefined, true)).toMatchObject({ opacity: 0.45, cursor: "grabbing" });
  });

  it("a plain click does not capture the pointer and the link click still fires", () => {
    const capture = spyCapture();
    const onClick = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    function LinkHarness() {
      const drag = useSidebarDrag({ projects: PROJECTS, order: ORDER, setOrder: () => {}, isMobile: false });
      return (
        <div {...drag.rowProps("p:anytts", null)}>
          <a href="/p/anytts" data-testid="link" onClick={onClick}>anytts</a>
        </div>
      );
    }
    try {
      render(<LinkHarness />);
      const link = screen.getByTestId("link");
      fireEvent.pointerDown(link, { button: 0, clientX: 0, clientY: 10, pointerId: 3 });
      fireEvent.pointerUp(window, { clientX: 0, clientY: 10, pointerId: 3 });
      fireEvent.click(link);
      expect(capture).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledTimes(1);
    } finally {
      capture.restore();
    }
  });

  it("drag past the threshold captures the pointer on the row", () => {
    const capture = spyCapture();
    try {
      render(<Harness onOrder={() => {}} />);
      startDrag("row-anytts");
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(1);
      expect(capture.mock.contexts[0]).toBe(screen.getByTestId("row-anytts"));
    } finally {
      capture.restore();
    }
  });

  it("hovering the dragged row itself shows no drop marker", () => {
    render(<Harness onOrder={() => {}} />);
    startDrag("row-anytts");
    hover("row-pavilio", 2);
    hover("row-anytts", 2);
    expect(screen.getByTestId("row-anytts").hasAttribute("data-drop")).toBe(false);
    expect(screen.getByTestId("row-pavilio").hasAttribute("data-drop")).toBe(false);
  });

  it("a slow refresh from an older drop does not overwrite a newer drop's order", async () => {
    let resolveList!: (r: Response) => void;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/projects") return new Promise<Response>((r) => (resolveList = r));
      return new Response(JSON.stringify({ group: "InfoPoly" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const listener = (e: Event) => {
      (e as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>).detail.waitUntil(
        fetch("/api/projects"),
      );
    };
    window.addEventListener("pavilio:projects-refresh", listener);
    const onOrder = vi.fn();
    try {
      render(<Harness onOrder={onOrder} />);
      // A: cross-group, its refresh hangs.
      startDrag("row-anytts");
      hover("row-g-InfoPoly", 10);
      await act(async () => drop());
      // B: same-group reorder, saved at once.
      startDrag("row-zdrofit-sniper");
      hover("row-omnivoice-server", 2);
      await act(async () => drop());
      expect(onOrder).toHaveBeenCalledTimes(1);
      const newer = onOrder.mock.calls[0][0] as SidebarOrder;
      expect(newer.groups["Motyl OSS"]).toEqual(["zdrofit-sniper", "omnivoice-server"]);
      expect(newer.groups.InfoPoly).toEqual(["infopoly", "anytts"]);
      await act(async () => resolveList(new Response("[]")));
      expect(onOrder).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("pavilio:projects-refresh", listener);
    }
  });

  it("group names that shadow Object.prototype drop like any group", () => {
    const tree = [
      { kind: "group" as const, name: "toString", members: ["a"] },
      { kind: "project" as const, name: "b" },
    ];
    const r = applyDrop(tree, { key: "p:b", container: null }, { key: "g:toString", container: null, edge: "into" });
    expect(r?.order.groups.toString).toEqual(["a", "b"]);
    expect(r?.group).toEqual({ project: "b", group: "toString" });
    const out = applyDrop(tree, { key: "p:a", container: "toString" }, { key: "p:b", container: null, edge: "after" });
    expect(out?.order.top).toEqual(["p:b", "p:a"]);
    expect(Object.hasOwn(out!.order.groups, "toString")).toBe(false);
  });

  it("unmount after a successful PUT still saves the order", async () => {
    const onOrder = vi.fn();
    let resolvePut: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolvePut = r; })));
    const { unmount } = render(<Harness onOrder={onOrder} />);
    startDrag("row-anytts");
    hover("row-g-InfoPoly", 10);
    drop();
    unmount();
    await act(async () => {
      resolvePut(new Response("{}", { status: 200 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onOrder).toHaveBeenCalledTimes(1);
  });
});
