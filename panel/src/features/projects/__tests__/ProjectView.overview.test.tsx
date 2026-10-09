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
 * Overview plus one other tab of the same project. The links sit outside
 * `Routes`; a tab switch unmounts the Overview branch (it renders only when no
 * section is open), so the round trip checks that reopening Overview starts
 * from a fresh, collapsed PROJECT.md.
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

  it("PROJECT.md and project settings start fresh after switching project", async () => {
    mockFetchResponses({
      "/api/projects/colors": { colors: {} },
      "/api/projects": [
        { name: "pavilio", path: "/root/git/prv/pavilio", repos: [] },
        { name: "other", path: "/root/git/prv/other", repos: [] },
      ],
      "/api/files/read/pavilio/PROJECT.md": {
        content: PROJECT_MD,
        absolutePath: "/root/git/prv/projects/projects/pavilio/PROJECT.md",
      },
      "/api/files/read/other/PROJECT.md": {
        content: "# Other\n\nOther project peek line.\n\nOther full-only paragraph.",
        absolutePath: "/root/git/prv/projects/projects/other/PROJECT.md",
      },
      "/api/scripts": { scripts: [] },
      "/api/files/index": [],
    });
    // Same `/project/:name` route for both, so ProjectView stays mounted.
    render(
      <MemoryRouter initialEntries={["/project/pavilio"]}>
        <Link to="/project/other">to other</Link>
        <Routes>
          <Route path="/project/:name" element={<ProjectView />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("project-md-peek");
    fireEvent.click(toggle());
    expect(await screen.findByText("Second paragraph, only in the full render.")).toBeInTheDocument();
    // A half-typed, rejected custom colour — local to the picker, not stored.
    const settings = screen.getByTestId("project-settings-card");
    fireEvent.change(within(settings).getByLabelText("Custom hex"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("project-color-apply-pavilio"));
    expect(within(settings).getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByText("to other"));

    expect(await screen.findByText("Other project peek line.")).toBeInTheDocument();
    expect(screen.getByTestId("project-md-peek")).toHaveTextContent("Other project peek line.");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Other full-only paragraph.")).toBeNull();
    const otherSettings = screen.getByTestId("project-settings-card");
    expect(within(otherSettings).getByLabelText("Custom hex")).toHaveValue("");
    expect(within(otherSettings).queryByRole("alert")).toBeNull();
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
