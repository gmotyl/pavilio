import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";
import { PROJECT_MARK_COMPONENTS, ProjectMark } from "../ProjectMark";
import { __resetMarkHashesForTests, rememberMarkHash } from "../markImage";
import {
  PROJECT_MARK_EMOJI,
  PROJECT_MARK_ICONS,
  derivedProjectColor,
  isSingleEmoji,
} from "../projectIdentity";

afterEach(() => {
  cleanup();
  localStorage.clear();
  __resetPreferenceStoreForTests();
  __resetMarkHashesForTests();
});

/** The browser normalises hex to rgb() inside serialised styles. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("ProjectMark", () => {
  it("lucide mark renders in the project colour on a tinted tile", () => {
    render(<ProjectMark project="alpha" mark="lucide:rocket" color="#e06c75" />);
    const tile = screen.getByTestId("project-mark");
    expect(tile.style.color).toBe("rgb(224, 108, 117)");
    expect(tile.style.background).toContain("color-mix");
    expect(tile.style.background).toContain(rgb("#e06c75"));
    expect(tile.style.border).toContain(rgb("#e06c75"));
    const icon = screen.getByTestId("project-mark-icon-rocket");
    expect(tile.contains(icon)).toBe(true);
    expect(icon.getAttribute("class")).toContain("lucide-rocket");
  });

  it("the registry names and the component map keys are the same set", () => {
    expect([...Object.keys(PROJECT_MARK_COMPONENTS)].sort()).toEqual([...PROJECT_MARK_ICONS].sort());
  });

  it("every registered name renders its own icon", () => {
    for (const name of PROJECT_MARK_ICONS) {
      render(<ProjectMark project="alpha" mark={`lucide:${name}`} />);
      expect(screen.getByTestId(`project-mark-icon-${name}`).tagName.toLowerCase()).toBe("svg");
      cleanup();
    }
  });

  it("reads the stored mark when no mark prop is given", () => {
    writePreference(preferences.projectMark, "lucide:rocket", "alpha");
    render(<ProjectMark project="alpha" />);
    expect(screen.getByTestId("project-mark-icon-rocket").getAttribute("class")).toContain(
      "lucide-rocket",
    );
  });

  it("an unknown lucide name falls back to the folder", () => {
    render(<ProjectMark project="alpha" mark="lucide:nope" />);
    expect(screen.getByTestId("project-mark-icon-folder").getAttribute("class")).toContain(
      "lucide-folder",
    );
  });

  it("emoji mark renders as text inside the tinted tile", () => {
    render(<ProjectMark project="alpha" mark="emoji:🚀" color="#61afef" />);
    const tile = screen.getByTestId("project-mark");
    expect(tile.textContent).toBe("🚀");
    expect(tile.style.background).toContain(rgb("#61afef"));
    expect(tile.querySelector("svg")).toBeNull();
  });

  it("no mark renders the default folder in the project colour", () => {
    render(<ProjectMark project="alpha" />);
    const tile = screen.getByTestId("project-mark");
    const hex = derivedProjectColor("alpha");
    expect(tile.style.background).toContain(rgb(hex));
    expect(screen.getByTestId("project-mark-icon-folder").getAttribute("class")).toContain(
      "lucide-folder",
    );
    expect(tile.getAttribute("data-color")).toBe(hex);
  });

  it("ProjectMark renders an image mark", () => {
    render(<ProjectMark project="my proj" mark="image:mark.png" color="#61afef" />);
    const tile = screen.getByTestId("project-mark");
    const img = tile.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/projects/my%20proj/mark");
    // Fills the tile, cropped square.
    expect(img?.style.width).toBe("100%");
    expect(img?.style.height).toBe("100%");
    expect(img?.style.objectFit).toBe("cover");
    expect(tile.querySelector("svg")).toBeNull();
    // A fresh upload's hash busts the browser's copy.
    act(() => rememberMarkHash("my proj", "abc123"));
    expect(tile.querySelector("img")?.getAttribute("src")).toBe("/api/projects/my%20proj/mark?v=abc123");
  });

  it("ProjectMark falls back to the folder glyph when the image fails", () => {
    render(<ProjectMark project="alpha" mark="image:mark.svg" color="#e06c75" />);
    const tile = screen.getByTestId("project-mark");
    fireEvent.error(tile.querySelector("img")!);
    expect(tile.querySelector("img")).toBeNull();
    expect(screen.getByTestId("project-mark-icon-folder").getAttribute("class")).toContain("lucide-folder");
    expect(tile.style.color).toBe(rgb("#e06c75"));
  });

  it("every curated emoji is a single emoji", () => {
    expect(Object.keys(PROJECT_MARK_EMOJI)).toEqual(["Tech", "Objects", "Nature", "Food", "Symbols", "Faces"]);
    const all = Object.values(PROJECT_MARK_EMOJI).flat();
    expect(all.length).toBeGreaterThanOrEqual(100);
    expect(new Set(all).size).toBe(all.length);
    for (const glyph of all) expect([glyph, isSingleEmoji(glyph)]).toEqual([glyph, true]);
  });
});

describe("ProjectMark — no project", () => {
  // `POST /api/terminal/sessions` defaults an omitted project to "", and a
  // whitespace-only directory name passes discovery. Neither is a preference
  // scope, so the mark must not read `project.mark` for it (storageKey throws).
  for (const project of ["", "   "]) {
    it(`renders a neutral folder tile for ${JSON.stringify(project)}`, () => {
      render(<ProjectMark project={project} />);
      const tile = screen.getByTestId("project-mark");
      expect(screen.getByTestId("project-mark-icon-folder")).toBeInTheDocument();
      expect(tile.dataset.color).toBe("var(--text-muted)");
    });
  }

  it("ignores an image mark for a missing project (no /api/projects//mark request)", () => {
    render(<ProjectMark project="" mark="image:mark.png" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("project-mark-icon-folder")).toBeInTheDocument();
  });
});
