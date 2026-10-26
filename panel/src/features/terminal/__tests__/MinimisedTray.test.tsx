import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";

// The tray's LEDs are the real per-session indicator elsewhere; here a stand-in
// that names its session is enough to prove each pill carries its own.
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: ({ sessionId }: { sessionId: string }) => (
    <span data-testid="activity-led" data-session={sessionId} />
  ),
}));

// Per-session activity for the folded counter's dot. The real flags hook is
// replaced so a test can say "this minimised session needs attention" without
// driving the activity channel — the same seam the mobile rail's suite uses.
const activityOf = vi.hoisted(() => new Map<string, "idle" | "busy" | "attention">());

vi.mock("../useTerminalActivityChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useTerminalActivityChannel")>()),
  useAggregateActivityFlags: (ids: readonly string[]) => ({
    hasBusy: ids.some((id) => activityOf.get(id) === "busy"),
    hasAttention: ids.some((id) => activityOf.get(id) === "attention"),
    hasAny: ids.length > 0,
    attentionSinceAt: null,
  }),
}));

import { MinimisedTray } from "../MinimisedTray";
import type { SessionMeta } from "../useTerminalSessions";
import { TEST_PROJECT_COLORS, installProjectColors } from "./projectColors.harness";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "claude-ch",
    project: "alpha",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const LONG = "alpha·1 — wiki ingest of the whole backlog";
const SESSIONS = [
  makeSession({ id: "m1", name: LONG, project: "alpha" }),
  makeSession({ id: "m2", name: "beta·1", project: "beta" }),
  makeSession({ id: "m3", name: "alpha·2", project: "alpha" }),
];

/**
 * jsdom lays nothing out, so every box measures 0 and the tray stays unfolded.
 * A narrow strip is staged by giving the tray's slot and the pills' natural
 * width real numbers — the same spy-on-`getBoundingClientRect` seam the boot
 * legend's suite uses.
 */
function stageWidths(slot: number, pills: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const id = (this as HTMLElement).dataset?.testid;
    const width = id === "minimised-tray-slot" ? slot : id === "minimised-tray-measure" ? pills : 0;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 20, right: width, width, height: 20, toJSON() {} } as DOMRect;
  });
}

beforeEach(() => {
  activityOf.clear();
  installProjectColors();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MinimisedTray", () => {
  it("tray pills show project mark, LED and truncated label with full tooltip", async () => {
    render(<MinimisedTray sessions={SESSIONS} onRestore={vi.fn()} />);
    await act(async () => {});

    const tray = screen.getByTestId("minimised-tray");
    expect(within(tray).getByTestId("minimised-tray-label")).toHaveTextContent("▁ minimised");

    const pills = within(tray).getAllByRole("button");
    expect(pills.map((p) => p.dataset.testid)).toEqual([
      "minimised-tray-pill-m1",
      "minimised-tray-pill-m2",
      "minimised-tray-pill-m3",
    ]);

    const first = screen.getByTestId("minimised-tray-pill-m1");
    // Mark tile in the project's colour, then the LED, then the label.
    const mark = within(first).getByTestId("project-mark");
    expect(mark).toHaveAttribute("data-color", TEST_PROJECT_COLORS.alpha);
    expect(within(screen.getByTestId("minimised-tray-pill-m2")).getByTestId("project-mark"))
      .toHaveAttribute("data-color", TEST_PROJECT_COLORS.beta);
    const led = within(first).getByTestId("activity-led");
    expect(led).toHaveAttribute("data-session", "m1");
    const label = within(first).getByText(LONG);
    expect(Array.from(first.children)).toEqual([mark, led, label]);

    // The label truncates with an ellipsis inside a capped pill…
    expect(label.style.textOverflow).toBe("ellipsis");
    expect(label.style.overflow).toBe("hidden");
    expect(label.style.whiteSpace).toBe("nowrap");
    expect(first.style.maxWidth).not.toBe("");
    // …and the tooltip carries it whole.
    expect(first.getAttribute("title")).toContain(LONG);
  });

  it("clicking a pill restores the session", () => {
    const onRestore = vi.fn();
    render(<MinimisedTray sessions={SESSIONS} onRestore={onRestore} />);

    fireEvent.click(screen.getByTestId("minimised-tray-pill-m2"));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("m2");
  });

  it("narrow strip folds the tray into a counter", () => {
    stageWidths(60, 420);
    const onRestore = vi.fn();
    render(<MinimisedTray sessions={SESSIONS} onRestore={onRestore} />);

    // No pills and no label: one "▁ N" counter.
    expect(screen.queryByTestId("minimised-tray")).toBeNull();
    expect(screen.queryByTestId("minimised-tray-pill-m1")).toBeNull();
    const counter = screen.getByTestId("minimised-tray-counter");
    expect(counter).toHaveTextContent("▁ 3");
    expect(counter).toHaveAccessibleName(/3 minimised terminals/i);

    fireEvent.click(counter);
    const menu = screen.getByRole("menu", { name: /minimised terminals/i });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    // Each row: mark, LED and the FULL label (no truncation in the menu).
    const first = items[0];
    expect(within(first).getByTestId("project-mark")).toHaveAttribute(
      "data-color",
      TEST_PROJECT_COLORS.alpha,
    );
    expect(within(first).getByTestId("activity-led")).toHaveAttribute("data-session", "m1");
    expect(first).toHaveTextContent(LONG);

    fireEvent.click(items[1]);
    expect(onRestore).toHaveBeenCalledWith("m2");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a full strip (slot squeezed to 0) folds the tray into a counter", () => {
    // In the panel the chips take every pixel once the strip is full, so the
    // slot measures exactly 0 — that is the narrowest strip, not an unmeasured one.
    stageWidths(0, 420);
    render(<MinimisedTray sessions={SESSIONS} onRestore={vi.fn()} />);

    expect(screen.queryByTestId("minimised-tray")).toBeNull();
    expect(screen.getByTestId("minimised-tray-counter")).toHaveTextContent("▁ 3");
    // Folded, the slot keeps the counter's own width instead of shrinking to 0.
    const slot = screen.getByTestId("minimised-tray-slot");
    expect(slot.style.minWidth).toBe("auto");
    expect(slot.style.overflow).toBe("visible");
  });

  it("unfolded pills sit in a group named for screen readers", () => {
    render(<MinimisedTray sessions={SESSIONS} onRestore={vi.fn()} />);

    const group = screen.getByRole("group", { name: "Minimised terminals" });
    expect(group).toBe(screen.getByTestId("minimised-tray"));
    // Unmeasured (both boxes 0) stays unfolded and lets the slot shrink.
    expect(screen.getByTestId("minimised-tray-slot").style.minWidth).toBe("0px");
  });

  it("counter dot shows the loudest minimised state", () => {
    stageWidths(60, 420);
    activityOf.set("m1", "busy");
    activityOf.set("m2", "attention");
    const { rerender } = render(<MinimisedTray sessions={SESSIONS} onRestore={vi.fn()} />);

    expect(screen.getByTestId("minimised-tray-counter-led")).toHaveAttribute(
      "data-state",
      "attention",
    );

    // Busy beats idle when nobody needs attention.
    activityOf.set("m2", "idle");
    rerender(<MinimisedTray sessions={[...SESSIONS]} onRestore={vi.fn()} />);
    expect(screen.getByTestId("minimised-tray-counter-led")).toHaveAttribute("data-state", "busy");

    activityOf.clear();
    rerender(<MinimisedTray sessions={[...SESSIONS]} onRestore={vi.fn()} />);
    expect(screen.getByTestId("minimised-tray-counter-led")).toHaveAttribute("data-state", "idle");
  });
});
