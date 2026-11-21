import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const proj = (name: string, group: string | null) => ({
  name,
  path: `/tmp/${name}`,
  hasIndex: false,
  hasNotes: false,
  hasProgress: false,
  hasPlans: false,
  hasWiki: false,
  latestProgressDate: "2026-11-18",
  kind: "project",
  lastActivity: null,
  repos: [],
  group,
});
const PROJECTS = [
  proj("a", "Favourites"),
  proj("b", "Other"),
  proj("c", "Dev"),
  proj("d", null),
  proj("e", null),
];

vi.mock("../useProjects", () => ({ useProjects: () => PROJECTS }));
vi.mock("../../mobile-access/MobileAccessButton", () => ({ MobileAccessButton: () => null }));

import Dashboard from "../Dashboard";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";

const mount = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
const sectionHeads = () =>
  screen.getAllByTestId("dashboard-section-head").map((h) => h.firstChild?.textContent);

describe("Dashboard section identity", () => {
  beforeEach(() => {
    __resetPreferenceStoreForTests();
    writePreference(preferences.favoriteProjects, ["d"]);
    writePreference(preferences.sidebarOrder, { top: ["g:Favourites", "g:Other", "g:Dev"], groups: {} });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("a group named Favourites filters apart from the built-in Favourites", () => {
    mount();
    expect(sectionHeads()).toEqual(["Favourites", "Favourites", "Other", "Dev", "Other"]);
    fireEvent.click(screen.getByTestId("group-chip-group:Favourites"));
    expect(sectionHeads()).toEqual(["Favourites"]);
    expect(screen.getByTestId("dashboard-project-card-a")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-project-card-d")).toBeNull();
    expect(readPreference(preferences.homeGroupFilter)).toBe("group:Favourites");
  });

  it("a group named Other filters apart from the built-in Other", () => {
    mount();
    fireEvent.click(screen.getByTestId("group-chip-other"));
    expect(screen.getByTestId("dashboard-project-card-e")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-project-card-b")).toBeNull();
  });

  it("an old plain-name stored filter still selects that group", () => {
    writePreference(preferences.homeGroupFilter, "Dev");
    mount();
    expect(screen.getByTestId("group-chip-group:Dev").getAttribute("aria-pressed")).toBe("true");
  });
});
