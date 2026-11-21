import { describe, it, expect, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectView from "../ProjectView";
import { mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { __resetPreferenceStoreForTests, writePreference } from "../../../preferences/store";

describe("ProjectView — Actions block across navigation", () => {
  afterEach(() => __resetPreferenceStoreForTests());

  it("renders exactly one Actions block after tab and project round trips", async () => {
    __resetPreferenceStoreForTests();
    writePreference(preferences.homeActions, [
      { label: "Process meetings", runner: "claude", text: "x", project: "workspace" },
      { label: "Knowledge harvest", runner: "claude", text: "y", project: "workspace" },
    ]);
    mockFetchResponses({
      "/api/projects/workspace/context": { project: "workspace", sources: [], contexts: [], adrs: [] },
      "/api/projects": [
        { name: "workspace", path: "/w", repos: [], group: "Core" },
        { name: "pavilio", path: "/p", repos: [], group: "Core" },
      ],
      "/api/files/read/": { content: "# W\n\n## Overview\n\nx", absolutePath: "/x/PROJECT.md" },
      "/api/scripts": { scripts: [] },
      "/api/files/index": [],
    });
    render(
      <MemoryRouter initialEntries={["/project/workspace"]}>
        <Link to="/project/workspace/context">ctx</Link>
        <Link to="/project/workspace">ov</Link>
        <Link to="/project/pavilio">pav</Link>
        <Routes>
          <Route path="/project/:name" element={<ProjectView />} />
          <Route path="/project/:name/:section" element={<ProjectView />} />
        </Routes>
      </MemoryRouter>,
    );
    // Each hop waits for its destination to render, then counts Actions
    // blocks there: one on Workspace's overview, none anywhere else.
    const settle = async (project: string, overview: boolean) => {
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(project),
      );
      if (overview) await screen.findByTestId("project-md");
      else await screen.findByTestId("context-tab-count");
    };
    await settle("workspace", true);
    await screen.findByTestId("actions-section");
    const hops: [string, string, boolean, number][] = [
      ["ctx", "workspace", false, 0],
      ["ov", "workspace", true, 1],
      ["pav", "pavilio", true, 0],
      ["ov", "workspace", true, 1],
      ["ctx", "workspace", false, 0],
      ["ov", "workspace", true, 1],
    ];
    for (const [link, project, overview, count] of hops) {
      fireEvent.click(screen.getByText(link));
      await settle(project, overview);
      if (count === 1) await screen.findByTestId("actions-section");
      expect(screen.queryAllByTestId("actions-section")).toHaveLength(count);
    }
    expect(screen.getAllByText("Process meetings")).toHaveLength(1);
  });
});
