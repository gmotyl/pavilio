import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLastPath } from "../useLastPath";
import { readLastPath } from "../lastPath";

function Harness({ project }: { project?: string }) {
  useLastPath(project);
  return (
    <>
      <Link to="/project/a/repos?file=foo.ts">go-repos</Link>
      <Link to="/project/a/notes?note=bar">go-notes</Link>
    </>
  );
}

describe("useLastPath", () => {
  beforeEach(() => sessionStorage.clear());

  it("writes current location on every navigation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={["/project/a"]}>
        <Routes>
          <Route path="/project/:name/*" element={<Harness project="a" />} />
          <Route path="/project/:name" element={<Harness project="a" />} />
        </Routes>
      </MemoryRouter>,
    );
    const links = container.querySelectorAll("a");
    await user.click(links[0]);
    expect(readLastPath("a")).toBe("/project/a/repos?file=foo.ts");
    await user.click(links[1]);
    expect(readLastPath("a")).toBe("/project/a/notes?note=bar");
  });

  it("does nothing when project is undefined", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="*" element={<Harness project={undefined} />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(container.querySelector("a")!);
    expect(readLastPath("a")).toBeNull();
  });
});
