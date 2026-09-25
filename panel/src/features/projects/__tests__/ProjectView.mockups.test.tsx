import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectView from "../ProjectView";
import { mockFetchResponses } from "../../../test-utils";

const MODIFIED = Date.parse("2026-09-20T10:00:00Z");

const indexEntry = (relativePath: string) => ({
  relativePath,
  project: relativePath.split("/")[0],
  modified: MODIFIED,
});

/**
 * ProjectView's mockups tab rides the generic section path, so the only fetches
 * it needs are the project list, the file index (the variable in these tests)
 * and the read of whatever file ends up selected — an un-ok read makes
 * useFileViewer clear the selection, which would silently defeat the two
 * detail-pane assertions.
 */
function renderMockups(
  files: string[],
  { section = "mockups", file }: { section?: string; file?: string } = {},
) {
  mockFetchResponses({
    "/api/projects": [
      { name: "pavilio", path: "/root/git/prv/pavilio", repos: [] },
    ],
    "/api/files/index": files.map(indexEntry),
    "/api/files/read/": { content: "# stub", absolutePath: "/abs/stub" },
    "/api/scripts": [],
  });
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return render(
    <MemoryRouter initialEntries={[`/project/pavilio/${section}${query}`]}>
      <Routes>
        <Route path="/project/:name/:section" element={<ProjectView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The copy is prose with code spans, so compare on collapsed whitespace. */
const collapse = (text: string | null) =>
  (text ?? "").replace(/\s+/g, " ").trim();

const EXPECTED_COPY =
  "No mockups yet. Run /pavilio-ui-design <what you're designing> in a " +
  "terminal — it works out the design direction, then writes a self-contained " +
  "HTML mockup to projects/pavilio/mockups/. It usually drafts two or three " +
  "options with a recommendation, so you have something to pick from. " +
  "/pavilio-mockup skips straight to the HTML when you already know what you " +
  "want.";

describe("the mockups detail pane", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders MockupFrame for an html file in the mockups section", async () => {
    renderMockups(["pavilio/mockups/boot-legend.html"], {
      file: "pavilio/mockups/boot-legend.html",
    });

    expect(await screen.findByTestId("mockup-viewer-frame")).toBeTruthy();
  });

  it("renders FileViewer for a markdown file in the mockups section", async () => {
    // The branch is on the extension, not the section: a note that happens to
    // live under mockups/ is still a document, not something to put in a frame.
    renderMockups(["pavilio/mockups/README.md"], {
      file: "pavilio/mockups/README.md",
    });

    expect(await screen.findByTestId("file-list-peek-trigger")).toBeTruthy();
    expect(screen.queryByTestId("mockup-viewer-frame")).toBeNull();
  });
});

describe("the mockups empty state", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the how-to empty state when there are no mockups", async () => {
    renderMockups([]);

    const empty = await screen.findByTestId("mockups-empty-state");
    expect(collapse(empty.textContent)).toBe(EXPECTED_COPY);
  });

  it("names the project in the empty state", async () => {
    renderMockups([]);

    const empty = await screen.findByTestId("mockups-empty-state");
    expect(collapse(empty.textContent)).toContain("projects/pavilio/mockups/");
    // The placeholder the user types is theirs to fill in, so it stays literal.
    expect(collapse(empty.textContent)).toContain("<what you're designing>");
  });

  it("does not show the generic no-files message in an empty mockups section", async () => {
    renderMockups([]);

    await screen.findByTestId("mockups-empty-state");
    expect(screen.queryByText("No files in this section.")).toBeNull();
  });

  it("leaves the notes section's empty message unchanged", async () => {
    renderMockups([], { section: "notes" });

    expect(await screen.findByText("No files in this section.")).toBeTruthy();
    expect(screen.queryByTestId("mockups-empty-state")).toBeNull();
  });
});
