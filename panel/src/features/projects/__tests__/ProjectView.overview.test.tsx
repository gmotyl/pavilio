import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectView from "../ProjectView";
import { mockFetchResponses } from "../../../test-utils";

const PROJECT_MD = [
  "# Pavilio",
  "",
  "> Last updated: 2026-09-17 · manual",
  "",
  "## Overview",
  "",
  "Open-source **starter kit** for [AI-assisted](https://example.com) workflows: a panel (`panel/`).",
  "",
  "## Repositories",
  "",
  "Second paragraph, only in the full render.",
].join("\n");

/**
 * Overview plus one other tab of the same project. The tab link sits outside
 * `Routes`, so switching tabs keeps ProjectView itself mounted — the case where
 * a component-level "expanded" flag would survive if it lived above the
 * Overview branch.
 */
function renderOverview() {
  return render(
    <MemoryRouter initialEntries={["/project/pavilio"]}>
      <Link to="/project/pavilio/context">to context</Link>
      <Link to="/project/pavilio">to overview</Link>
      <Routes>
        <Route path="/project/:name" element={<ProjectView />} />
        <Route path="/project/:name/:section" element={<ProjectView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pattern order matters: `mockFetchResponses` matches by substring, first hit wins. */
function stubOverview({ projectMd = true }: { projectMd?: boolean } = {}) {
  mockFetchResponses({
    "/api/projects/colors": { colors: {} },
    "/api/projects/pavilio/context": { project: "pavilio", sources: [], contexts: [], adrs: [] },
    "/api/projects": [{ name: "pavilio", path: "/root/git/prv/pavilio", repos: [] }],
    ...(projectMd
      ? {
          "/api/files/read/pavilio/PROJECT.md": {
            content: PROJECT_MD,
            absolutePath: "/root/git/prv/projects/projects/pavilio/PROJECT.md",
          },
        }
      : {}),
    "/api/scripts": { scripts: [] },
    "/api/files/index": [],
  });
}

const toggle = () => screen.getByRole("button", { name: /PROJECT\.md/ });

describe("ProjectView — Overview", () => {
  beforeEach(() => {
    stubOverview();
  });

  it("overview shows actions, then PROJECT.md, then project settings", async () => {
    renderOverview();
    const actions = await screen.findByTestId("project-view-vscode");
    const md = screen.getByTestId("project-md");
    const settings = screen.getByTestId("project-settings-card");

    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(actions, md)).toBe(true);
    expect(follows(md, settings)).toBe(true);
  });

  it("PROJECT.md starts collapsed with a one-line peek", async () => {
    renderOverview();
    const peek = await screen.findByTestId("project-md-peek");

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle()).getByText("Show")).toBeInTheDocument();
    // First real paragraph — the title heading and the "Last updated" quote are
    // not what the project is — as plain text on one line.
    expect(peek).toHaveTextContent(
      "Open-source starter kit for AI-assisted workflows: a panel (panel/).",
    );
    expect(peek.textContent).not.toMatch(/[*`#>[\]]/);
    expect(peek).toHaveClass("truncate");
    expect(screen.queryByText("Second paragraph, only in the full render.")).toBeNull();

    // Expanded on this visit, collapsed again on the next one.
    fireEvent.click(toggle());
    expect(await screen.findByText("Second paragraph, only in the full render.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("to context"));
    await waitFor(() => expect(screen.queryByTestId("project-md")).toBeNull());
    fireEvent.click(screen.getByText("to overview"));

    expect(await screen.findByTestId("project-md-peek")).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Second paragraph, only in the full render.")).toBeNull();
  });

  it("a PROJECT.md load error shows without expanding", async () => {
    stubOverview({ projectMd: false });
    renderOverview();

    expect(await screen.findByText(/Failed to load PROJECT\.md/)).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByTestId("project-md")).getByText(/Failed to load/)).toBeInTheDocument();
  });

  it("the settings card carries the voice select and the inline colour picker", async () => {
    renderOverview();
    const card = await screen.findByTestId("project-settings-card");

    expect(within(card).getByText("Project settings")).toBeInTheDocument();
    expect(within(card).getByTestId("project-voice-select")).toHaveAttribute(
      "id",
      "project-voice-pavilio",
    );
    // Inline: the palette is laid out in place, no trigger to open first.
    expect(within(card).getByRole("group", { name: "Colour for pavilio" })).toBeInTheDocument();
    expect(
      within(card).getByTestId("project-color-preset-pavilio-gold"),
    ).toBeInTheDocument();
    // The voice select brings its own "overrides default" tag — the card adds no second one.
    expect(within(card).queryAllByText("overrides default")).toHaveLength(0);
  });
});
