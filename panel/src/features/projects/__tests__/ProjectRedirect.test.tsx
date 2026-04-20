import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import ProjectRedirect from "../ProjectRedirect";
import { writeLastPath } from "../../shell/lastPath";

function FallbackMarker() {
  return <div data-testid="fallback-rendered" />;
}

describe("ProjectRedirect", () => {
  beforeEach(() => sessionStorage.clear());

  it("navigates to stored path when present and different from current", () => {
    writeLastPath("pavilio", "/project/pavilio/repos?file=foo.ts");
    render(
      <MemoryRouter initialEntries={["/project/pavilio"]}>
        <Routes>
          <Route path="/project/:name" element={<ProjectRedirect fallback={<FallbackMarker />} />} />
          <Route path="/project/:name/repos" element={<div data-testid="repos-section" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("repos-section")).toBeInTheDocument();
  });

  it("renders the fallback when no stored path", () => {
    render(
      <MemoryRouter initialEntries={["/project/pavilio"]}>
        <Routes>
          <Route path="/project/:name" element={<ProjectRedirect fallback={<FallbackMarker />} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("fallback-rendered")).toBeInTheDocument();
  });

  it("renders fallback when stored path equals current (avoids redirect loop)", () => {
    writeLastPath("pavilio", "/project/pavilio");
    render(
      <MemoryRouter initialEntries={["/project/pavilio"]}>
        <Routes>
          <Route path="/project/:name" element={<ProjectRedirect fallback={<FallbackMarker />} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("fallback-rendered")).toBeInTheDocument();
  });
});
