import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectView from "../ProjectView";
import { mockFetchResponses } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

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

/**
 * jsdom computes no layout, so nothing below may assert a pixel height. What is
 * under test is the class contract ProjectView renders: the chain of height
 * owners that lets the mockup frame fill the pane instead of the page scrolling.
 */
const classesOf = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** Appended to `project-view` only while the open file is a mockup. */
const VIEW_FILL = ["md:flex", "md:flex-col", "md:h-full", "md:min-h-0"];
/** What `FileListSidebar` appends to its detail pane when `fillHeight` is on. */
const DETAIL_FILL = ["md:h-full", "md:min-h-0"];

const view = () => screen.getByTestId("project-view");
/** The positioned wrapper ProjectView renders around the page body. */
const outer = () => view().parentElement!;

describe("the mockup fill chain", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills the pane when the selected file is an html mockup", async () => {
    renderMockups(["pavilio/mockups/boot-legend.html"], {
      file: "pavilio/mockups/boot-legend.html",
    });

    const detail = await screen.findByTestId("file-list-sidebar-detail");
    expect(classesOf(outer())).toContain("relative");
    expect(classesOf(outer())).toContain("md:h-full");
    expect(classesOf(view())).toEqual(expect.arrayContaining(VIEW_FILL));
    expect(classesOf(detail)).toEqual(expect.arrayContaining(DETAIL_FILL));
  });

  it("leaves the page scrolling when the selected file is markdown", async () => {
    // The regression guard for `useTabScrollMemory` on the text sections: a
    // fill made unconditional would bound the page height here too and kill
    // the remembered scroll position.
    renderMockups(["pavilio/mockups/README.md"], {
      file: "pavilio/mockups/README.md",
    });

    const detail = await screen.findByTestId("file-list-sidebar-detail");
    expect(classesOf(outer())).not.toContain("md:h-full");
    for (const cls of VIEW_FILL) expect(classesOf(view())).not.toContain(cls);
    for (const cls of DETAIL_FILL) expect(classesOf(detail)).not.toContain(cls);
  });

  it("fills the pane for an html file selected outside the mockups section", async () => {
    // The condition is the extension, not the section — an html file filed
    // under notes/ goes in the frame and gets the same height chain.
    renderMockups(["pavilio/notes/demo.html"], {
      section: "notes",
      file: "pavilio/notes/demo.html",
    });

    const detail = await screen.findByTestId("file-list-sidebar-detail");
    expect(classesOf(view())).toEqual(expect.arrayContaining(VIEW_FILL));
    expect(classesOf(detail)).toEqual(expect.arrayContaining(DETAIL_FILL));
  });

  it("leaves the page scrolling when no file is selected", async () => {
    renderMockups([], { section: "notes" });

    await screen.findByText("No files in this section.");
    expect(classesOf(outer())).not.toContain("md:h-full");
    for (const cls of VIEW_FILL) expect(classesOf(view())).not.toContain(cls);
  });

  it("keeps the compact width cap when wide mode is off and a mockup is open", async () => {
    const prefs = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
      .__PAVILIO_PREFS__!;
    prefs[storageKey(preferences.wideMode, "mockups")] = false;
    renderMockups(["pavilio/mockups/boot-legend.html"], {
      file: "pavilio/mockups/boot-legend.html",
    });

    await screen.findByTestId("file-list-sidebar-detail");
    // Width and height are independent: the fill must not disturb the clamp.
    expect(classesOf(view())).toContain("max-w-5xl");
    expect(classesOf(view())).toEqual(expect.arrayContaining(VIEW_FILL));
  });
});
