import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TerminalToolbar } from "../TerminalToolbar";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import type { SessionMeta } from "../useTerminalSessions";
import { INERT_SPEECH } from "./speech.harness";
import { installMatchMedia } from "../../../test-utils";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));
vi.mock("../useOsUsers", () => ({ useOsUsers: () => ({ users: [] }) }));
vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({ defaultUsers: {}, setDefaultUser: async () => {} }),
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [
    { name: "pavilio", repos: [] },
    { name: "motyl", group: "Motyl OSS", repos: [] },
    { name: "woozle", group: "InfoPoly", repos: [] },
    { name: "anytts", group: "Motyl OSS", repos: [] },
    { name: "metro", group: null, repos: [] },
  ],
}));
const store = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }));
vi.mock("../sessionStore", async (orig) => ({
  ...(await orig<typeof import("../sessionStore")>()),
  refreshSessions: store.refresh,
}));

function mk(id: string, project = "motyl"): SessionMeta {
  return { id, name: id, project, cwd: "/tmp", pid: 1, createdAt: "2026-11-17T00:00:00Z" };
}

function renderToolbar(over: Partial<Parameters<typeof TerminalToolbar>[0]> = {}) {
  const props: Parameters<typeof TerminalToolbar>[0] = {
    sessions: [mk("m1"), mk("m2"), mk("m3")],
    focusedId: "m1",
    maximized: false,
    currentProject: "motyl",
    onFocus: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(async () => true),
    onRename: vi.fn(),
    onToggleMaximize: vi.fn(),
    onReorder: vi.fn(),
    ...over,
  };
  render(<TerminalToolbar {...props} />);
  return props;
}

const menu = () => screen.queryByRole("menu", { name: "Session menu" });
const rightClickChip = (id: string) =>
  fireEvent.contextMenu(screen.getByTestId(`terminal-toolbar-chip-${id}`));

beforeEach(() => {
  installMatchMedia();
  __resetAlertsForTests();
  store.refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SessionContextMenu", () => {
  it("right-click on a chip opens the session menu", () => {
    renderToolbar();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByTestId("terminal-toolbar-chip-m2").dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    const m = menu()!;
    // Mockup check: chip menu — header, Close (hint), Close others, Close all, separator, Move to.
    expect(within(m).getByText("m2")).toBeTruthy();
    const items = within(m).getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(["CloseAlt+Shift+W", "Close others", "Close all", "Move to…▸"]);
    expect(within(m).getByRole("separator")).toBeTruthy();
  });

  it("right-click on a cell header opens the same menu", async () => {
    render(
      <TerminalLayoutGrid
        sessions={[mk("c1"), mk("c2")]}
        focusedId="c1"
        maximized={false}
        onFocus={vi.fn()}
        onExit={vi.fn()}
        speech={INERT_SPEECH}
      />,
    );
    await act(async () => {});
    const header = document.querySelector('[data-terminal-cell="c2"] [data-terminal-cell-header]')!;
    fireEvent.contextMenu(header);
    const m = menu()!;
    expect(within(m).getByText("c2")).toBeTruthy();
    expect(within(m).getAllByRole("menuitem")).toHaveLength(4);
  });

  it("no menu on mobile", () => {
    installMatchMedia({ mobile: true });
    renderToolbar();
    rightClickChip("m1");
    expect(menu()).toBeNull();
  });

  it("keyboard navigates and activates", () => {
    renderToolbar();
    rightClickChip("m1");
    const m = menu()!;
    fireEvent.keyDown(m, { key: "ArrowDown" });
    fireEvent.keyDown(m, { key: "ArrowDown" });
    fireEvent.keyDown(m, { key: "Enter" });
    expect(menu()).toBeNull();
    expect(screen.getByText("Close 3 terminals?")).toBeTruthy();

    // Escape and an outside click close it.
    fireEvent.click(screen.getByText("Cancel"));
    rightClickChip("m1");
    fireEvent.keyDown(menu()!, { key: "Escape" });
    expect(menu()).toBeNull();
    rightClickChip("m1");
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
  });

  it("close opens the single confirmation and others the bulk one including minimised", () => {
    renderToolbar({ minimisedIds: ["m3"] });
    rightClickChip("m1");
    fireEvent.click(within(menu()!).getByText("Close"));
    expect(screen.getByRole("alertdialog").textContent).toContain("m1");
    fireEvent.click(screen.getByText("Cancel"));

    rightClickChip("m1");
    fireEvent.click(within(menu()!).getByText("Close others"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Close 2 other terminals?");
    expect(dialog.textContent).toContain("m3");
  });

  it("close others disabled when alone", () => {
    renderToolbar({ sessions: [mk("solo")] });
    rightClickChip("solo");
    const item = within(menu()!).getByText("Close others").closest('[role="menuitem"]')!;
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("bulk kill continues past a failure and alerts", async () => {
    const onDelete = vi.fn(async (id: string) => id !== "m2");
    renderToolbar({ onDelete });
    rightClickChip("m1");
    fireEvent.click(within(menu()!).getByText("Close all"));
    fireEvent.click(screen.getByRole("button", { name: "Close 3" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(getAlertsSnapshot().some((a) => `${a.title} ${a.detail ?? ""}`.includes("m2"))).toBe(true),
    );
  });

  it("move to lists projects by group with current disabled", () => {
    renderToolbar();
    rightClickChip("m1");
    fireEvent.click(within(menu()!).getByText("Move to…"));
    const sub = screen.getByRole("menu", { name: "Move to" });
    const rows = Array.from(sub.querySelectorAll("[data-move-row]")).map(
      (el) => `${el.getAttribute("data-move-row")}:${el.textContent}`,
    );
    // Mockup check: Move to — group headers, ungrouped last, current disabled.
    expect(rows).toEqual([
      "label:InfoPoly",
      "project:woozle",
      "label:Motyl OSS",
      "project:motyl (current)",
      "project:anytts",
      "sep:",
      "project:pavilio",
      "project:metro",
    ]);
    const current = within(sub).getByText("motyl (current)").closest('[role="menuitem"]')!;
    expect(current.getAttribute("aria-disabled")).toBe("true");
    expect(sub.querySelectorAll("[data-move-row=project] [data-testid=project-mark]").length).toBe(5);
  });

  it("picking a project sends the move patch and reloads sessions", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderToolbar();
    rightClickChip("m1");
    fireEvent.click(within(menu()!).getByText("Move to…"));
    fireEvent.click(within(screen.getByRole("menu", { name: "Move to" })).getByText("woozle"));
    await waitFor(() => expect(store.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/sessions/m1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ project: "woozle" }) }),
    );
  });
});
