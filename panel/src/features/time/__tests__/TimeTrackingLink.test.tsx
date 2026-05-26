import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimeTrackingLink } from "../TimeTrackingLink";
import { formatMinutes } from "../formatMinutes";

describe("formatMinutes", () => {
  it("returns empty string for 0", () => expect(formatMinutes(0)).toBe(""));
  it("returns Nm for under an hour", () => expect(formatMinutes(45)).toBe("45m"));
  it("returns Nh for whole hours", () => expect(formatMinutes(60)).toBe("1h"));
  it("returns Nh Mm for mixed", () => expect(formatMinutes(105)).toBe("1h 45m"));
});

describe("TimeTrackingLink", () => {
  const renderIt = (minutes: number) =>
    render(
      <MemoryRouter>
        <TimeTrackingLink minutes={minutes} to="/project/p/time" />
      </MemoryRouter>,
    );

  it("always renders a link, even when minutes <= 0", () => {
    renderIt(0);
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("shows 'Time tracking' fallback when minutes <= 0", () => {
    renderIt(0);
    expect(screen.getByRole("link")).toHaveTextContent("⌛ Time tracking");
  });

  it("shows formatted minutes when minutes > 0", () => {
    renderIt(105);
    expect(screen.getByRole("link")).toHaveTextContent("⌛ Time · 1h 45m");
  });

  it("links to the provided path", () => {
    renderIt(15);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/project/p/time");
  });
});
