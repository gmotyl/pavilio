import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import ProjectView from "../ProjectView";
import { PAVILIO_FILE_MIME_TYPE } from "../../explorer/useFileDrag";
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

  it("opens an archived project's mockup from a copied link", async () => {
    // Copy link targets `/project/<p>/mockups?file=archived/<p>/mockups/…`;
    // the file is not in the section list, but the pane still frames it.
    renderMockups(["archived/pavilio/mockups/old.html"], {
      file: "archived/pavilio/mockups/old.html",
    });

    const frame = await screen.findByTestId("mockup-viewer-frame");
    expect(frame).toHaveAttribute("src", "/api/files/raw/archived/pavilio/mockups/old.html");
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

  it("html mockup unchanged", async () => {
    renderMockups(["pavilio/mockups/boot-legend.html"], {
      file: "pavilio/mockups/boot-legend.html",
    });

    // The frame and its viewport-width picker, and no image or zoom toggle.
    expect(await screen.findByTestId("mockup-viewer-frame")).toBeTruthy();
    expect(screen.getByTestId("mockup-viewer-width-full")).toBeTruthy();
    expect(screen.getByTestId("mockup-viewer-width-tablet")).toBeTruthy();
    expect(screen.getByTestId("mockup-viewer-width-phone")).toBeTruthy();
    expect(screen.queryByTestId("mockup-viewer-image")).toBeNull();
    expect(screen.queryByTestId("mockup-viewer-zoom-fit")).toBeNull();
  });

  it("renders an image mockup as an img without reading it as text", async () => {
    renderMockups(["pavilio/mockups/2026-10-07-hero.PNG"], {
      file: "pavilio/mockups/2026-10-07-hero.PNG",
    });

    const img = await screen.findByTestId("mockup-viewer-image");
    expect(img.tagName).toBe("IMG");
    expect(screen.queryByTestId("mockup-viewer-frame")).toBeNull();
    // The read only resolves the absolute path; the bytes are never decoded
    // as utf-8 text.
    const reads = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => String(input))
      .filter((url) => url.startsWith("/api/files/read/"));
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) expect(url).toContain("meta=1");
  });
});

describe("copying a mockup's content", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies an svg mockup's source, read as text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderMockups(["pavilio/mockups/icon.svg"], { file: "pavilio/mockups/icon.svg" });

    const button = await screen.findByTestId("mockup-viewer-copy-content");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenLastCalledWith("# stub");
    const reads = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => String(input))
      .filter((url) => url.startsWith("/api/files/read/pavilio/mockups/"));
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) expect(url).not.toContain("meta=1");
  });

  it("copies an html mockup's source", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderMockups(["pavilio/mockups/boot.html"], { file: "pavilio/mockups/boot.html" });

    const button = await screen.findByTestId("mockup-viewer-copy-content");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("# stub"));
  });

  it("keeps copy content off for a raster mockup", async () => {
    renderMockups(["pavilio/mockups/hero.png"], { file: "pavilio/mockups/hero.png" });

    expect(await screen.findByTestId("mockup-viewer-image")).toBeTruthy();
    expect(screen.getByTestId("mockup-viewer-copy-content")).toBeDisabled();
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

  it("image mockup fills the pane height", async () => {
    renderMockups(["pavilio/mockups/2026-10-07-hero.webp"], {
      file: "pavilio/mockups/2026-10-07-hero.webp",
    });

    const detail = await screen.findByTestId("file-list-sidebar-detail");
    await screen.findByTestId("mockup-viewer-image");
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

  it("leaves the page scrolling when a special section is open", async () => {
    // `repos` is one of SPECIAL_SECTIONS, which render no FileListSidebar at
    // all — so there is nothing to fill. The `?file=` param is deliberately an
    // html path: the special-section test is what must keep the fill off, not
    // the absence of an html-looking file in the URL.
    renderMockups(["pavilio/mockups/boot-legend.html"], {
      section: "repos",
      file: "pavilio/mockups/boot-legend.html",
    });

    await screen.findByTestId("project-view");
    expect(screen.queryByTestId("file-list-sidebar-detail")).toBeNull();
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

/** Shows the router's query string so a test can read the `?file=` selection. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

/**
 * Like `renderMockups`, but the import endpoints are routed before the
 * `/api/projects` prefix would swallow them, and the index can change after
 * an import lands.
 */
function renderWithImport(
  initialFiles: string[],
  {
    section = "mockups",
    importResult,
  }: {
    section?: string;
    importResult?: Array<{ name: string; relativePath: string; ok: boolean; error?: string }>;
  } = {},
) {
  let index = initialFiles;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const json = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
    if (url.endsWith("/mockups/import")) {
      const files = importResult ?? [];
      index = [...index, ...files.filter((f) => f.ok).map((f) => f.relativePath)];
      return json({ files });
    }
    if (url.endsWith("/mockups/inspect")) return json({ files: [] });
    if (url.includes("/api/projects"))
      return json([{ name: "pavilio", path: "/root/git/prv/pavilio", repos: [] }]);
    if (url.includes("/api/files/index")) return json(index.map(indexEntry));
    if (url.includes("/api/files/read/"))
      return json({ content: "# stub", absolutePath: "/abs/stub" });
    if (url.includes("/api/scripts")) return json([]);
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={[`/project/pavilio/${section}`]}>
      <Routes>
        <Route
          path="/project/:name/:section"
          element={
            <>
              <ProjectView />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("importing mockups", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("import button only on mockups", async () => {
    renderWithImport(["pavilio/mockups/boot-legend.html"]);
    expect(await screen.findByTestId("mockups-import-button")).toBeTruthy();
    cleanup();

    renderWithImport(["pavilio/notes/2026-10-01-a.md"], { section: "notes" });
    await screen.findByTestId("section-files-count");
    expect(screen.queryByTestId("mockups-import-button")).toBeNull();
    expect(screen.queryByTestId("mockups-empty-import-button")).toBeNull();
  });

  it("empty state offers import", async () => {
    renderWithImport([]);

    // The how-to paragraph is kept as it was …
    const empty = await screen.findByTestId("mockups-empty-state");
    expect(collapse(empty.textContent)).toBe(EXPECTED_COPY);
    // … and the import path is offered beside it.
    expect(screen.getByTestId("mockups-empty-import-button")).toBeTruthy();
    expect(screen.getByText("Or import a Figma export — SVG, PNG, JPEG, WebP or HTML.")).toBeTruthy();
  });

  it("import selects the first saved file", async () => {
    renderWithImport(["pavilio/mockups/boot-legend.html"], {
      importResult: [
        { name: "2026-10-07-frame-12.png", relativePath: "pavilio/mockups/2026-10-07-frame-12.png", ok: true },
        { name: "2026-10-07-frame-13.png", relativePath: "pavilio/mockups/2026-10-07-frame-13.png", ok: true },
      ],
    });

    const input = (await screen.findByTestId("mockups-import-button-input")) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "Frame 12.png"), new File(["y"], "Frame 13.png")] },
    });
    expect(await screen.findByTestId("mockup-import-dialog")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId("mockup-import-confirm"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("location-search").textContent).toBe(
        `?file=${encodeURIComponent("pavilio/mockups/2026-10-07-frame-12.png")}`,
      ),
    );
    expect(screen.queryByTestId("mockup-import-dialog")).toBeNull();
    // The list refreshes and shows the imported files.
    expect(await screen.findByText(/2026-10-07-frame-13/)).toBeTruthy();
  });

  it("dropping files on the mockups list opens the dialog", async () => {
    renderWithImport([]);
    const target = await screen.findByTestId("mockups-drop-target");

    fireEvent.drop(target, {
      dataTransfer: { files: [new File(["x"], "Frame 12.png")], types: ["Files"] },
    });

    const dialog = await screen.findByTestId("mockup-import-dialog");
    expect(dialog).toBeTruthy();
  });
  it("ignores a panel row drag that carries no files", async () => {
    renderWithImport([]);
    const target = await screen.findByTestId("mockups-drop-target");

    // fireEvent returns false only when a handler called preventDefault.
    const notCancelled = fireEvent.dragOver(target, {
      dataTransfer: { files: [], types: [PAVILIO_FILE_MIME_TYPE, "text/plain"] },
    });
    expect(notCancelled).toBe(true);
    expect(target.style.outline).toBe("");

    fireEvent.drop(target, {
      dataTransfer: { files: [], types: [PAVILIO_FILE_MIME_TYPE, "text/plain"] },
    });
    expect(screen.queryByTestId("mockup-import-dialog")).toBeNull();
  });

  it("highlights the drop target for an OS file drag", async () => {
    renderWithImport([]);
    const target = await screen.findByTestId("mockups-drop-target");

    const notCancelled = fireEvent.dragOver(target, {
      dataTransfer: { files: [], types: ["Files"] },
    });
    expect(notCancelled).toBe(false);
    expect(target.style.outline).toContain("dashed");
  });
});
