import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../useProjects", () => ({
  useProjects: () => [
    {
      name: "metro",
      path: "/tmp/metro",
      hasIndex: false,
      hasNotes: false,
      hasProgress: false,
      hasPlans: false,
      hasWiki: false,
      latestProgressDate: null,
      kind: "project",
      lastActivity: null,
      repos: [],
    },
  ],
}));
vi.mock("../../mobile-access/MobileAccessButton", () => ({
  MobileAccessButton: () => null,
}));

import Dashboard from "../Dashboard";
import { preferences } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  writePreference,
} from "../../../preferences/store";
import { __resetProjectColorsForTests } from "../../terminal/useProjectColors";

/** A CSS colour as jsdom serialises it, so a hex and its rgb() compare equal. */
function normalised(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  return probe.style.color;
}

describe("Dashboard card identity", () => {
  beforeEach(() => {
    __resetProjectColorsForTests();
    __resetPreferenceStoreForTests();
    writePreference(preferences.projectColor, "#d19a66", "metro");
    writePreference(preferences.projectMark, "lucide:cart", "metro");
  });

  afterEach(() => {
    cleanup();
    __resetProjectColorsForTests();
    localStorage.clear();
    __resetPreferenceStoreForTests();
  });

  it("Dashboard card shows a 28px mark and a coloured name", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const card = screen.getByTestId("dashboard-project-card-metro");
    const tile = card.querySelector("[data-testid='project-mark']") as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.style.width).toBe("28px");
    expect(tile.style.height).toBe("28px");
    expect(tile.getAttribute("data-color")).toBe("#d19a66");
    expect(tile.querySelector("[data-testid='project-mark-icon-cart']")).toBeTruthy();

    const name = screen.getByRole("heading", { name: "metro" });
    expect(name.style.color).toBe(normalised("#d19a66"));
    // The tile leads the name.
    expect(
      tile.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
