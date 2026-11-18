import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import ProjectGroupStrip from "../ProjectGroupStrip";
import type { Project } from "../useProjects";

const p = (name: string, group: string | null): Project => ({
  name, path: name, hasIndex: true, hasNotes: false, hasProgress: false, hasPlans: false,
  hasWiki: false, latestProgressDate: null, kind: "project", lastActivity: null, repos: [], group,
});

// useProjects excludes archived projects; "oldpoly" (archived) is simply absent.
let list: Project[] = [];
vi.mock("../useProjects", () => ({ useProjects: () => list }));
vi.mock("../ProjectMark", () => ({ ProjectMark: ({ project }: { project: string }) => <span data-testid={`mark-${project}`} /> }));

function Where() { return <div data-testid="loc">{useLocation().pathname}</div>; }
function renderStrip(project: string) {
  return render(
    <MemoryRouter initialEntries={["/project/" + project]}>
      <Routes><Route path="*" element={<><ProjectGroupStrip project={project} /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

describe("ProjectGroupStrip", () => {
  it("strip names the group and links siblings", () => {
    list = [p("woozle", "InfoPoly"), p("infopoly", "InfoPoly"), p("other", null)];
    renderStrip("woozle");
    const strip = screen.getByRole("navigation", { name: /project group/i });
    expect(strip.textContent).toContain("Group:");
    expect(strip.textContent).toContain("InfoPoly");
    const chip = screen.getByRole("link", { name: /infopoly/i });
    expect(screen.getByTestId("mark-infopoly")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /woozle|other/i })).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByTestId("loc").textContent).toBe("/project/infopoly");
  });

  it("archived siblings are omitted", () => {
    list = [p("woozle", "InfoPoly"), p("infopoly", "InfoPoly")];
    renderStrip("woozle");
    expect(screen.queryByRole("link", { name: /oldpoly/i })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("no strip without a group", () => {
    list = [p("woozle", null), p("infopoly", "InfoPoly")];
    renderStrip("woozle");
    expect(screen.queryByRole("navigation", { name: /project group/i })).toBeNull();
  });
});
