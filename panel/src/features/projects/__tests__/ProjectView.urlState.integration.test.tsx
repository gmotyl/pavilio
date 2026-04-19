/**
 * Integration tests for last-path persistence loop.
 *
 * ProjectView is a large component that requires many providers and fetch calls.
 * Per the task spec, we replace the first two tests with lightweight harnesses
 * that exercise the real useLastPath hook and ProjectRedirect component directly,
 * preserving the three intents:
 *   (a) useLastPath writes on navigation
 *   (b) ProjectRedirect redirects to stored path
 *   (c) per-project isolation
 */
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import ProjectRedirect from "../ProjectRedirect";
import { useLastPath } from "../../shell/useLastPath";
import { readLastPath, writeLastPath } from "../../shell/lastPath";

/** Minimal stand-in for ProjectView: just calls useLastPath so storage is written. */
function FakeProjectView() {
  const { name } = useParams<{ name: string }>();
  useLastPath(name);
  return <div data-testid="project-view" />;
}

function stubFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/files/read/")) {
      return new Response(
        JSON.stringify({ content: "stub content", absolutePath: u }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("ProjectView URL state persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", stubFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes last path to storage on navigation inside a project", async () => {
    render(
      <MemoryRouter
        initialEntries={["/project/pavilio/notes?file=pavilio/notes/foo.md"]}
      >
        <Routes>
          <Route
            path="/project/:name"
            element={<ProjectRedirect fallback={<FakeProjectView />} />}
          />
          <Route path="/project/:name/:section" element={<FakeProjectView />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(readLastPath("pavilio")).toBe(
        "/project/pavilio/notes?file=pavilio/notes/foo.md",
      ),
    );
  });

  it("redirects /project/:name to the stored last path", async () => {
    writeLastPath(
      "pavilio",
      "/project/pavilio/notes?file=pavilio/notes/foo.md",
    );
    render(
      <MemoryRouter initialEntries={["/project/pavilio"]}>
        <Routes>
          <Route
            path="/project/:name"
            element={<ProjectRedirect fallback={<FakeProjectView />} />}
          />
          <Route path="/project/:name/:section" element={<FakeProjectView />} />
        </Routes>
      </MemoryRouter>,
    );
    // After redirect, useLastPath writes the new location back to storage —
    // it should equal the stored path.
    await waitFor(() =>
      expect(readLastPath("pavilio")).toBe(
        "/project/pavilio/notes?file=pavilio/notes/foo.md",
      ),
    );
  });

  it("keeps each project's last path independent", () => {
    writeLastPath("a", "/project/a/notes?file=a.md");
    writeLastPath("b", "/project/b/repos?repo=r&file=x.ts");
    expect(readLastPath("a")).toBe("/project/a/notes?file=a.md");
    expect(readLastPath("b")).toBe("/project/b/repos?repo=r&file=x.ts");
  });
});
