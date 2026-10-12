import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectMark } from "../ProjectMark";
import { derivedProjectColor } from "../projectMark";

afterEach(cleanup);

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
    expect(screen.getByTestId("project-mark-icon-folder")).toBeTruthy();
    expect(tile.getAttribute("data-color")).toBe(hex);
  });
});
