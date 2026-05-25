import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimeBadge, formatMinutes } from "../TimeBadge";

describe("formatMinutes", () => {
  it("returns empty string for 0", () => expect(formatMinutes(0)).toBe(""));
  it("returns Nm for under an hour", () => expect(formatMinutes(45)).toBe("45m"));
  it("returns Nh for whole hours", () => expect(formatMinutes(60)).toBe("1h"));
  it("returns Nh Mm for mixed", () => expect(formatMinutes(105)).toBe("1h 45m"));
});

describe("TimeBadge", () => {
  const renderIt = (minutes: number) =>
    render(
      <MemoryRouter>
        <TimeBadge minutes={minutes} to="/project/p/time" />
      </MemoryRouter>,
    );

  it("renders nothing when minutes <= 0", () => {
    const { container } = renderIt(0);
    expect(container.firstChild).toBeNull();
  });

  it("renders the formatted minutes with hourglass", () => {
    renderIt(105);
    expect(screen.getByRole("link")).toHaveTextContent("⌛ 1h 45m");
  });

  it("links to the provided path", () => {
    renderIt(15);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/project/p/time");
  });
});
