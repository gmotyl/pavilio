import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { installMatchMedia } from "../../../test-utils";

vi.mock("../useProjects", () => ({
  useProjects: () => [
    {
      name: "vector",
      path: "/tmp/vector",
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

const nativeMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

/** Reports the path the card's tap landed on. */
function Landed() {
  return <div data-testid="landed">{useLocation().pathname}</div>;
}

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dashboard project card destination", () => {
  afterEach(() => {
    if (nativeMatchMedia)
      Object.defineProperty(window, "matchMedia", nativeMatchMedia);
    else delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("Dashboard card opens terminals on a mobile viewport", () => {
    installMatchMedia({ mobile: true });
    renderDashboard();

    fireEvent.click(screen.getByTestId("dashboard-project-card-vector"));
    expect(screen.getByTestId("landed")).toHaveTextContent(
      "/project/vector/iterm",
    );
  });

  it("Dashboard card opens the bare project route on desktop", () => {
    installMatchMedia();
    renderDashboard();

    fireEvent.click(screen.getByTestId("dashboard-project-card-vector"));
    expect(screen.getByTestId("landed").textContent).toBe("/project/vector");
  });
});
