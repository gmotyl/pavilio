import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const env = vi.hoisted(() => ({ mobile: false }));
vi.mock("../useIsMobile", () => ({ useIsMobile: () => env.mobile }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../../projects/useProjects", () => ({ refreshProjects: refresh }));
const alertErr = vi.hoisted(() => vi.fn());
vi.mock("../../alerts/store", () => ({ alerts: { error: alertErr } }));

import { useSidebarRowMenu } from "../SidebarRowMenu";
import type { SidebarOrder } from "../sidebarOrder";

const ORDER: SidebarOrder = {
  top: ["g:InfoPoly", "p:pavilio"],
  groups: { InfoPoly: ["woozle", "anytts"] },
};

function Harness({
  setOrder = () => {},
  setCollapsed = () => {},
  collapsed = {},
}: {
  setOrder?: (o: SidebarOrder) => void;
  setCollapsed?: (c: Record<string, boolean>) => void;
  collapsed?: Record<string, boolean>;
}) {
  const m = useSidebarRowMenu({
    groups: ["InfoPoly", "Motyl OSS"],
    order: ORDER,
    setOrder,
    collapsed,
    setCollapsed,
  });
  return (
    <>
      <div data-testid="woozle" onContextMenu={(e) => m.onProjectContextMenu(e, "woozle", "InfoPoly")} />
      <div data-testid="pavilio" onContextMenu={(e) => m.onProjectContextMenu(e, "pavilio", null)} />
      <div data-testid="g" onContextMenu={(e) => m.onGroupContextMenu(e, "InfoPoly", () => {})} />
      {m.element}
    </>
  );
}

const items = () => screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
const item = (label: string) =>
  screen.getAllByRole("menuitem").find((el) => el.textContent?.includes(label))!;

beforeEach(() => {
  env.mobile = false;
  refresh.mockClear();
  alertErr.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function prompt(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

describe("SidebarRowMenu", () => {
  it("project menu lists groups with current checked", () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("woozle"));
    fireEvent.click(item("Group"));
    const sub = screen.getByRole("menu", { name: "Group" });
    const rows = [...sub.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')].map((e) => e.textContent?.trim());
    expect(rows).toEqual(["✓InfoPoly", "Motyl OSS", "New group…", "Remove from group"]);
    expect(screen.getByRole("menuitemradio", { name: /InfoPoly/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: /Motyl OSS/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("group menu offers rename and collapse", () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("g"));
    expect(items()).toEqual(["Rename…", "Collapse"]);
    cleanup();
    render(<Harness collapsed={{ InfoPoly: true }} />);
    fireEvent.contextMenu(screen.getByTestId("g"));
    expect(items()).toEqual(["Rename…", "Expand"]);
  });

  it("new group sends put with the name", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("pavilio"));
    fireEvent.click(item("Group"));
    fireEvent.click(item("New group…"));
    prompt("Tooling");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/pavilio/group");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ group: "Tooling" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("remove from group sends null and is disabled when ungrouped", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("pavilio"));
    fireEvent.click(item("Group"));
    expect(item("Remove from group").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item("Remove from group"));
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("woozle"));
    fireEvent.click(item("Group"));
    fireEvent.click(item("Remove from group"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/woozle/group");
    expect(JSON.parse(String(init.body))).toEqual({ group: null });
  });

  it("rename calls endpoint and moves order keys", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const setOrder = vi.fn();
    const setCollapsed = vi.fn();
    render(<Harness setOrder={setOrder} setCollapsed={setCollapsed} collapsed={{ InfoPoly: true }} />);
    fireEvent.contextMenu(screen.getByTestId("g"));
    fireEvent.click(item("Rename…"));
    prompt("Infopoly Ltd");
    await waitFor(() => expect(setOrder).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/groups/rename");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ from: "InfoPoly", to: "Infopoly Ltd" });
    expect(setOrder.mock.calls[0][0]).toEqual({
      top: ["g:Infopoly Ltd", "p:pavilio"],
      groups: { "Infopoly Ltd": ["woozle", "anytts"] },
    });
    expect(setCollapsed).toHaveBeenCalledWith({ "Infopoly Ltd": true });
    expect(refresh).toHaveBeenCalled();
  });

  it("rename collision alerts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "exists" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const setOrder = vi.fn();
    const setCollapsed = vi.fn();
    render(<Harness setOrder={setOrder} setCollapsed={setCollapsed} />);
    fireEvent.contextMenu(screen.getByTestId("g"));
    fireEvent.click(item("Rename…"));
    prompt("Motyl OSS");
    await waitFor(() => expect(alertErr).toHaveBeenCalled());
    expect(String(alertErr.mock.calls[0][0])).toMatch(/Motyl OSS/);
    expect(setOrder).not.toHaveBeenCalled();
    expect(setCollapsed).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no row menus on mobile", () => {
    env.mobile = true;
    render(<Harness />);
    fireEvent.contextMenu(screen.getByTestId("woozle"));
    fireEvent.contextMenu(screen.getByTestId("g"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
