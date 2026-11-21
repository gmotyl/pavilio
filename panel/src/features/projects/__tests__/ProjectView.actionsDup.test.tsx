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
    await screen.findByTestId("actions-section");
    for (const hop of ["ctx", "ov", "pav", "ov", "ov", "ctx", "ov"]) {
      fireEvent.click(screen.getByText(hop));
      await new Promise((r) => setTimeout(r, 30));
    }
    await waitFor(() => expect(screen.getAllByTestId("actions-section")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getAllByTestId("actions-section")).toHaveLength(1);
    expect(screen.getAllByText("Process meetings")).toHaveLength(1);
  });
});
