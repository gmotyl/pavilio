import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectTimePage from "../ProjectTimePage";

describe("ProjectTimePage", () => {
  it("renders the project name in the header", () => {
    render(
      <MemoryRouter initialEntries={["/project/metro/time"]}>
        <Routes>
          <Route path="/project/:name/time" element={<ProjectTimePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("metro · Time");
  });

  it("renders the empty state when there are no entries", () => {
    render(
      <MemoryRouter initialEntries={["/project/metro/time"]}>
        <Routes>
          <Route path="/project/:name/time" element={<ProjectTimePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("No entries yet.")).toBeInTheDocument();
  });
});
