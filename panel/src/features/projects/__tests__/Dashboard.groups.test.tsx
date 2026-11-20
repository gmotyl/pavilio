import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const proj = (name: string, group: string | null, date: string | null = "2026-11-18") => ({
  name,
  path: `/tmp/${name}`,
  hasIndex: false,
  hasNotes: false,
  hasProgress: false,
  hasPlans: false,
  hasWiki: false,
  latestProgressDate: date,
  kind: "project",
  lastActivity: null,
  repos: [],
  group,
});
const PROJECTS = [
  proj("metro", "Clients"),
  proj("infopoly", "Clients"),
  proj("pavilio", "Workspace"),
  proj("gitara", null),
];

vi.mock("../useProjects", () => ({ useProjects: () => PROJECTS }));
vi.mock("../../mobile-access/MobileAccessButton", () => ({
  MobileAccessButton: () => null,
}));

import Dashboard from "../Dashboard";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";

function mount() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}
const chip = (label: RegExp) => screen.getByRole("button", { name: label });

describe("Dashboard groups", () => {
  beforeEach(() => {
    __resetPreferenceStoreForTests();
    writePreference(preferences.favoriteProjects, ["metro", "gitara"]);
    writePreference(preferences.starredOrder, ["gitara", "metro"]);
    writePreference(preferences.sidebarOrder, {
      top: ["g:Workspace", "g:Clients"],
      groups: { Clients: ["infopoly", "metro"] },
    });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("renders Projects heading and count line", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
    // Favourites is a view over the groups, so only Workspace and Clients count.
    expect(screen.getByText("4 projects in 2 groups")).toBeTruthy();
  });

  it("chip row starts with All and shows counts; active chip is aria-pressed", () => {
    mount();
    const group = screen.getByRole("group", { name: "Filter by group" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "All4",
      "Favourites2",
      "Workspace1",
      "Clients2",
    ]);
    expect(chip(/^All/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/^Clients/).getAttribute("aria-pressed")).toBe("false");
  });

  it("All renders headed sections in order, starred grouped project in both", () => {
    mount();
    const heads = screen.getAllByTestId("dashboard-section-head");
    expect(heads.map((h) => h.textContent)).toEqual([
      "Favourites2",
      "Workspace1",
      "Clients2",
    ]);
    const fav = screen.getByTestId("dashboard-section-Favourites");
    expect(
      within(fav).getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["gitara", "metro"]);
    const clients = screen.getByTestId("dashboard-section-Clients");
    expect(
      within(clients).getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["infopoly", "metro"]);
    expect(screen.getAllByTestId("dashboard-project-card-metro")).toHaveLength(2);
  });

  it("group chip shows only that section", () => {
    mount();
    fireEvent.click(chip(/^Clients/));
    expect(chip(/^Clients/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/^All/).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("dashboard-section-Workspace")).toBeNull();
    expect(screen.queryByTestId("dashboard-section-Favourites")).toBeNull();
    expect(screen.getByTestId("dashboard-section-Clients")).toBeTruthy();
    expect(readPreference(preferences.homeGroupFilter)).toBe("Clients");
  });

  it("cards keep icon, name, last active and star", () => {
    mount();
    const card = within(screen.getByTestId("dashboard-section-Workspace")).getByTestId(
      "dashboard-project-card-pavilio",
    );
    expect(card.querySelector("[data-testid='project-mark']")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "pavilio" })).toBeTruthy();
    expect(card.textContent).toMatch(/Last active Nov 18/);
    const starred = screen.getAllByTestId("dashboard-project-card-metro")[0];
    expect(starred.querySelector("svg.lucide-star")?.getAttribute("fill")).not.toBe("none");
    const plain = card.querySelector("svg.lucide-star");
    expect(plain?.getAttribute("fill")).toBe("none");
  });

  it("selected chip survives remount; unknown chip falls back to All", () => {
    const first = mount();
    fireEvent.click(chip(/^Workspace/));
    first.unmount();
    mount();
    expect(chip(/^Workspace/).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    writePreference(preferences.homeGroupFilter, "Gone");
    mount();
    expect(chip(/^All/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("dashboard-section-Clients")).toBeTruthy();
  });

  it("chip row wraps", () => {
    mount();
    const group = screen.getByRole("group", { name: "Filter by group" });
    expect(group.className).toContain("flex-wrap");
    // Each chip is its own flex item, so a 390px pane wraps rather than scrolls.
    expect(group.className).not.toMatch(/overflow-x-(auto|scroll)|flex-nowrap/);
  });
});
