import { describe, expect, it } from "vitest";
import { buildSections } from "../dashboardSections";

const p = (name: string, group: string | null = null) => ({ name, group });
const names = (s: { projects: { name: string }[] }) => s.projects.map((x) => x.name);

describe("buildSections", () => {
  it("sections are Favourites, groups in sidebar order, then Other", () => {
    const projects = [p("a", "Dev"), p("b", "Clients"), p("c", "Dev"), p("d"), p("e")];
    const sections = buildSections({
      projects,
      favorites: new Set(["e", "d"]),
      starredOrder: ["e", "d"],
      sidebarOrder: { top: ["g:Dev", "g:Clients"], groups: { Dev: ["c", "a"] } },
    });
    expect(sections.map((s) => s.name)).toEqual(["Favourites", "Dev", "Clients"]);
    expect(names(sections[0])).toEqual(["e", "d"]);
    expect(names(sections[1])).toEqual(["c", "a"]);
  });

  it("ungrouped non-starred projects fall into trailing Other", () => {
    const sections = buildSections({
      projects: [p("a", "G"), p("x"), p("y")],
      favorites: new Set(["x"]),
      starredOrder: [],
      sidebarOrder: { top: [], groups: {} },
    });
    expect(sections.map((s) => s.name)).toEqual(["Favourites", "G", "Other"]);
    expect(names(sections[2])).toEqual(["y"]);
  });

  it("starred grouped project appears in Favourites and its group", () => {
    const sections = buildSections({
      projects: [p("a", "G"), p("b", "G")],
      favorites: new Set(["a"]),
      starredOrder: [],
      sidebarOrder: { top: [], groups: {} },
    });
    expect(names(sections[0])).toEqual(["a"]);
    expect(names(sections[1])).toEqual(["a", "b"]);
  });

  it("starred projects missing from starredOrder follow in current order", () => {
    const sections = buildSections({
      projects: [p("a"), p("b"), p("c")],
      favorites: new Set(["a", "b", "c"]),
      starredOrder: ["c"],
      sidebarOrder: { top: [], groups: {} },
    });
    expect(names(sections[0])).toEqual(["c", "a", "b"]);
  });

  it("empty sections are not rendered", () => {
    const sections = buildSections({
      projects: [p("a", "G")],
      favorites: new Set(),
      starredOrder: [],
      sidebarOrder: { top: [], groups: {} },
    });
    expect(sections.map((s) => s.name)).toEqual(["G"]);
  });
});
